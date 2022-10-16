const moment = require("moment");
const csv = require('csv-parser');
const fs = require('fs');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const { Configuration, OpenAIApi } = require("openai");
const fetch = require('node-fetch');

const htmlUtils = require('./htmlUtils');
const stringUtils = require('./stringUtils');
const requestUtils = require('./requestUtils');

moment.locale('fr-fr');

let totalUsed = 0;
let globalTotalUsed = 0;

// Configuration

const SHOW_PROMPT = true;
const EXTRACT_HTML = false;
const EXTRACT_HTMLS = true;
const USE_BACKGROUND_INFO = false || EXTRACT_HTML || EXTRACT_HTMLS;
const LEVENSHTEIN_PERCENT = 65; // percent max otherwise we reload
const LEVENSHTEIN_MAX_RETRY = 2; // number max of retry 

const options = [{ label: "Background info", value: USE_BACKGROUND_INFO },
{ label: "Extract from html", value: EXTRACT_HTML },
{ label: "Extract from csv htmls", value: EXTRACT_HTMLS },
{ label: "Show prompt", value: SHOW_PROMPT },
{ label: "Levelshtein percent", value: LEVENSHTEIN_PERCENT },
{ label: "Levelshtein max retry", value: LEVENSHTEIN_MAX_RETRY }]

const startDate = new Date("2022-08-01 8:00");
const intervaleHour = "12";
const outputFormat = "YYYY-MM-DD HH:mm";

const regexTable = /^\s*(\d\s?(\.|\)))*\s*/;

const DEFAULT_TABLE_CONTENT_PATH = "tableContent.txt";

// Background infos
const DEFAULT_BACKGROUND_INFO_PATH = "backgroundinfo.txt";
const DEFAULT_BACKGROUND_INFO_PATH_OLD = "backgroundinfo_old.txt";
let backgroundInfo = fs.readFileSync(DEFAULT_BACKGROUND_INFO_PATH, "utf8")

// HTML file base
const DEFAULT_HTML_PATH = 'html.txt';
const DEFAULT_HTMLS_PATH = 'htmls.csv';

// Prompts

const createPrompt1 = (titre) => {
  return `rédige une table des matières très détaillée pour un article sur le sujet : ${titre}\nNe pas prévoir une partie Introduction\nNe pas prévoir une partie Conclusion.`
}

const createPrompt11 = (titre, outputPrompt1) => {
  return `Pour un article sur le sujet: ${titre} Repete cette table des matières: ${outputPrompt1} \nRéfléchis à des améliorations qui pourraient être apportées à ce sommaire pour qu'il soit plus complet et plus efficace.`
}

const createPrompt2 = (titre, outputPrompt11) => {
  return `rédige un court texte d'intro en français jusqu'à 80 mots pour le post de blog : ${titre}.`
}

const createPrompt3 = (titre, outputPrompt1) => {
  return `rédige une courte meta description en français jusqu'à 30 mots pour le post de blog : : ${titre}\nMettre un majuscule en début de phrase\nne pas dépasser les 155 caractères maximum.`
}

// Reformule background
const createPrompt31 = (backgroundInfo) => {
  return `Reformule complètement ce texte en français :\n"${backgroundInfo}"\n\nTexte reformulé :`
}

// infos-clés du background reformulé
const createPrompt311 = (backgroundInfo) => {
  return `Quels sont les informations clés de ce texte: :\n"${backgroundInfo}"\n\nJusque 10 informations clés : -`
}

//Sujet étant les différents élements du prompt 1
//VERSION SANS TEXTE INTRO + SOUS TITRES
const createPrompt4 = (titre, sujet, level = 2) => {
  let background = USE_BACKGROUND_INFO && backgroundInfo ? `INFORMATIONS CLES : -${backgroundInfo}\n\n` : '';
  return `SUJET DE L'ARTICLE : ${titre}\n\nSUJET DU PARAGRAPHE : ${sujet}\n\n${background}\n\nrédige un paragraphe très détaillé en français\nutilise toujours des mots de liaisons\najoute des transitions entre les phrases\nn'ajoute pas de <h1>\ntraduire les mots anglais en français\n
PARAGRAPHE DETAILLE :`
}

//VERSION AVEC TEXTE INTRO + SOUS TITRES
const createPrompt41 = (titre, sujet, level = 2) => {
  let background = USE_BACKGROUND_INFO && backgroundInfo ? `INFORMATIONS CLES : -${backgroundInfo}\n\n` : '';
  return `SUJET DE L'ARTICLE : ${titre}\n\nSUJET DU PARAGRAPHE : ${sujet}\n\n${background}\n\nrédige un paragraphe engageant et très détaillé\nutilise toujours des mots de liaisons\najoute des transitions entre les phrases\nn'ajoute pas de <h1>\nn'ajoute pas de <h2>\najoute un texte d’introduction\najoute toujours des sous-titres <h${level + 1}>\nutilise toujours des balises <p>\ntraduire les mots anglais en français\n
PARAGRAPHE ENGAGEANT :`
}

// Conclusion
const createPrompt5 = (titre, outputPrompt1) => {
  return `rédige un texte de conclusion pour un article sur le sujet : ${titre}.\nCONCLUSION : `
}

// Identifie le mot-clé principal utilisé pour la recherche d'image
const createPrompt6 = (titre) => {
  return `what is the most important single word of this text : ${titre}\ntraduit en anglais\nMost important Word: `
}

// OpenAI Config

const configuration = new Configuration({
  apiKey: process.env['OPENAI_API_KEY'],
});
const openai = new OpenAIApi(configuration);

// CSV
const titles = [];
const crs = fs.createReadStream('sujets.csv')
  .pipe(csv())
  .on('data', (row) => {
    titles.push({ ...row });
  })

const csvEnd = new Promise(function(resolve, reject) {
  crs.on('end', () => {
    console.log('CSV file successfully processed');
    resolve(titles)
  });
});

const urls = [];
const csvHtmls = fs.createReadStream(DEFAULT_HTMLS_PATH)
  .pipe(csv())
  .on('data', (row) => {
    urls.push({ ...row });
  })

const csvHtmlsEnd = new Promise(function(resolve, reject) {
  csvHtmls.on('end', () => {
    console.log('CSV file successfully processed');
    resolve(urls);
  });
});


const csvHeader = [
  { id: 'title', title: 'Title' },
  { id: 'description', title: 'Description' },
  { id: 'full', title: 'Full Text' },
  { id: 'image', title: 'Image' },
  { id: 'token', title: 'Token Used' },
];

const csvWriter = createCsvWriter({
  path: 'datas.csv',
  header: csvHeader,
});

const csvWriterAppend = createCsvWriter({
  path: 'datasAppend.csv',
  header: csvHeader,
  append: true,
});

const csvErrorsWriterAppend = createCsvWriter({
  path: 'errors.csv',
  header: [
    { id: 'title', title: 'Title' },
    { id: 'description', title: 'Description' },
    { id: 'full', title: 'Full Text' },
    { id: 'regex', title: 'Regex Used' },
  ],
  append: true,
});

function addHours(date = new Date(), numOfHours = intervaleHour) {
  date.setTime(date.getTime() + numOfHours * 60 * 60 * 1000);
  return date;
}

function separator() {
  console.log('----------------------------------------');
}

function getDeepth(subject) {
  if (!subject) {
    return -1;
  }
  return regexTable.exec(subject)[0].split(/\.|\)/).length
}

function isPromptYes(val) {
  return ["oui", 'o', 'yes', 'y'].includes(val.toLowerCase());
}

async function asyncGetUrlHTML(url) {
  const response = await fetch(url);
  const body = await response.text();
  return body;
}

async function asyncCallOpenAI(prompt) {
  if (SHOW_PROMPT) {
    separator();
    console.log(`-- Running this prompt --`);
    console.log(`-- ${prompt} --`);
    separator();
  }
  const result = await openai.createCompletion({
    model: "text-davinci-002",
    prompt: prompt,
    temperature: 0.7,
    max_tokens: 3000,
    top_p: 1,
    frequency_penalty: 0.4,
    presence_penalty: 0.2,
  });

  separator();
  const usage = result.data.usage;
  totalUsed += usage.total_tokens;
  console.log(`-- ${usage.total_tokens} Tokens used (${usage.prompt_tokens} + ${usage.completion_tokens}) --`);
  separator();

  let resultText = result.data.choices[0].text?.trim()
  return resultText;
}

(async function() {
  let titres = await csvEnd;
  console.log(titres);
  separator();
  
  //TODO instead of top + modify the for after
  /*if (!EXTRACT_HTML && !EXTRACT_HTMLS) {
  titres = await csvEnd;
  console.log(titres);
  separator();
  }*/
  
  const res = [];
  const saved = [];

  let extract = [];
  let tableMatiere = "";
  let extractFiltered = [];
  let websites = [];

  if (EXTRACT_HTMLS) {
    let htmls = await csvHtmlsEnd;
    websites = await Promise.all(
      htmls.map(async ({ url, stop, tag }) => {
        const res = await asyncGetUrlHTML(url)
        let html = stop.trim() ? res.split(stop.trim())[0] : res;
        const h1Split = html.split(/<h1/i);
        if( h1Split.length > 1 ) {
          console.log(`Removed ${h1Split[0].length} chars from html (${h1Split.length})`)
          html = `<h1${h1Split[1]}`;
        }
        // Remove comments from html
        html = html.replaceAll(/<!--.*?-->/gi, '');
        separator();
        console.log(`- ${url} -`);
        console.log(`- ${stop} ${tag} -`);
        separator();
        const extract = htmlUtils.getTitlesFromHTML(html);
        console.log(extract)
        separator();
        console.log(htmlUtils.getTableMatiere(extract))
        separator();
        return { html: html, url: url, tag: tag }
      }));
    //console.log(websites);
    separator();
  }

  for (let j = 0; j < Math.max(1, websites.length); j++) {
    if (EXTRACT_HTML || EXTRACT_HTMLS) {
      let html = EXTRACT_HTML ? fs.readFileSync(DEFAULT_HTML_PATH, "utf8") : websites[j]?.html;
      extract = htmlUtils.getTitlesFromHTML(html);
      tableMatiere = htmlUtils.getTableMatiere(extract);
      extractFiltered = extract.filter((e) => e.tag !== 'H1')

      if (EXTRACT_HTML) {
        console.log(tableMatiere)
      }
      separator();
    }

    // Only check first time for EXTRACT_HTMLS
    if (EXTRACT_HTML || (EXTRACT_HTMLS && j === 0)) {
      const checkOptions = prompt(`Récap des options:\n\n${options.map((o) => `${o.label} : ${o.value}`).join('\n')}\n\nVoulez-vous continuer avec ces options ? (Réponse: Oui/Non)`);
      if (!isPromptYes(checkOptions)) {
        return;
      }
    }

    for (let i = 0; i < titres.length; i++) {
      console.log(`-- ${new Date().toLocaleString('fr')} --`)
      console.log(`-- Génération du contenu ${i + 1} sur ${titres.length} --`);
      let { title: titre } = titres[i];

      let text = "";
      if (!EXTRACT_HTML && !EXTRACT_HTMLS) {
        let aiPrompt = createPrompt1(titre);

        while (true) {
          text = await asyncCallOpenAI(aiPrompt);
          separator();
          console.log("Ancienne génération\n", saved.join('\n'));
          separator();
          console.log(text);
          separator();

          const response = prompt("On continue avec ça ? (Réponse: Oui/Non/Combo)");
          if (isPromptYes(response)) {
            break;
          }
          if (["combo", 'c'].includes(response.toLowerCase())) {
            saved.push(text);
            fs.writeFileSync(DEFAULT_TABLE_CONTENT_PATH, saved.join('\n'));
            const combo = prompt("Pour combiner, modifiez le fichier tableContent.txt dans l'ordre que vous souhaitez (attention de bien garder les . derrières les chiffres ex: 1. / 1.1. / 1.2.3. ) puis répondez oui.");
            if (isPromptYes(combo)) {
              text = fs.readFileSync(DEFAULT_TABLE_CONTENT_PATH, "utf8");
              break;
            }
          }
          saved.push(text);
        }

        for (let i = 0; i < 2; i++) {
          separator();
          console.log(text);
          aiPrompt = createPrompt11(titre, text);
          text = await asyncCallOpenAI(aiPrompt);
        }
      } else {
        titre = extract[0].title;
        text = tableMatiere;
      }

      separator();
      let tableMatsFinal = text.replace("Table des matières", '').replaceAll("\n\n", '\n')
      console.log(tableMatsFinal);

      separator();
      aiPrompt = createPrompt2(titre, tableMatsFinal);
      const introText = await asyncCallOpenAI(aiPrompt);
      console.log("introText")
      console.log(introText)
      separator();

      separator();
      aiPrompt = createPrompt3(titre, tableMatsFinal);
      const metaDescriptionText = await asyncCallOpenAI(aiPrompt);
      console.log("metaDescriptionText")
      console.log(metaDescriptionText)
      separator();

      const subjects = tableMatsFinal.split('\n').map(t => t.trim()).filter(t => t);
      console.log(subjects)
      const subjectsData = []
      const deepthParent = {};

      let str1 = "";
      let str2 = "";
      for (let i = 0; i < subjects.length; i++) {
        separator();
        const deepth = getDeepth(subjects[i]);
        const deepthNext = getDeepth(subjects[i + 1]);
        const formatedSubject = subjects[i].replace(regexTable, "")
        deepthParent[deepth] = formatedSubject;
        console.log(formatedSubject)
        separator();
        if (formatedSubject) {
          if (EXTRACT_HTML || EXTRACT_HTMLS) {
            backgroundInfo = extractFiltered[i].paragraph;
            if (backgroundInfo) {
              aiPrompt = createPrompt31(backgroundInfo);
              backgroundInfo = await asyncCallOpenAI(aiPrompt);
            }
            if (backgroundInfo) {
              aiPrompt = createPrompt311(backgroundInfo);
              backgroundInfo = await asyncCallOpenAI(aiPrompt);
            }
          }

          let retry = 0;
          let distanceLevenshtein = 0;
          let percentLevenshtein = 0;
          let sectionText = "";
          let best = { percent: 100, text: '' };

          do {
            aiPrompt = createPrompt4(deepth > 2 ? deepthParent[deepth - 1] : titre, formatedSubject, deepth);
            if (deepthNext > deepth) {
              aiPrompt = createPrompt2(formatedSubject);
            }
            sectionText = await asyncCallOpenAI(aiPrompt);

            // Levenshtein
            str1 = extractFiltered[i].paragraph;
            str2 = sectionText;
            distanceLevenshtein = stringUtils.levenshteinDistance(str1, str2);
            percentLevenshtein = stringUtils.levenshteinSimilarity(distanceLevenshtein, str1, str2);
            separator();
            console.log(str1);
            console.log("\nVS\n");
            console.log(str2);
            separator();
            console.log("Résultat Levenshtein :", distanceLevenshtein, `${percentLevenshtein}%`);
            separator();

            // Compare similarity percent to save the new best
            if (best.percent > percentLevenshtein) {
              best = { percent: percentLevenshtein, text: sectionText };
            }
            retry++;
          } while (percentLevenshtein > LEVENSHTEIN_PERCENT && retry <= LEVENSHTEIN_MAX_RETRY);

          if (best.text) {
            sectionText = best.text;
          }

          if (!sectionText.includes(`<h${deepth}>`)) {
            sectionText = `<h${deepth}>${formatedSubject}</h${deepth}>\n\n${sectionText}`
          }
          console.log(sectionText)
          subjectsData.push(sectionText);
        }
      }

      //console.log(subjectsData)

      separator();
      aiPrompt = createPrompt5(titre, tableMatsFinal);
      let conclusionText = await asyncCallOpenAI(aiPrompt);
      conclusionText = `<h2>En résumé</h2>\n${conclusionText}`
      console.log("conclusionText")
      console.log(conclusionText)
      separator();

      // Get Image and Video
      separator();
      let image = null;
      if( EXTRACT_HTMLS ) {
        const imageTag = websites[j]?.tag;
        image = await requestUtils.getPixabayImage(imageTag);
        console.log(image, " for tag", imageTag);
      }
      const video = await requestUtils.getYoutubeVideo(titre, false);
      const videoText = `\n<h2>Vidéo sur le sujet</h2>\n${video}`;

      separator();
      let concat = [introText, subjectsData.join('\n'), conclusionText, videoText].join('\n')

      // Rework text to avoid repetition
      concat = stringUtils.replaceTooOften(concat, "Tout d'abord,", 3, ["Premièrement,", "Pour commencer,", "En premier,"]);
      separator();

      const datas = {
        title: titre,
        description: metaDescriptionText,
        full: concat,
        image: image,
        token: totalUsed,
        //tableMatiere: tableMatsFinal,
      }

      res.push(datas)
      csvWriterAppend.writeRecords([datas])

      globalTotalUsed += totalUsed;
      totalUsed = 0;
    }
    console.log(`Total tokens used: ${globalTotalUsed}`);
    separator();
    csvWriter
      .writeRecords(res)
      .then(() => console.log('The CSV file was written successfully'));

    if (USE_BACKGROUND_INFO) {
      fs.writeFileSync(DEFAULT_BACKGROUND_INFO_PATH_OLD, backgroundInfo);
      fs.writeFileSync(DEFAULT_BACKGROUND_INFO_PATH, "");
    }
  }
}());