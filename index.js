const moment = require("moment");
const csv = require('csv-parser');
const fs = require('fs');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const { Configuration, OpenAIApi } = require("openai");
const jsdom = require("jsdom");
const fetch = require('node-fetch');

moment.locale('fr-fr');

let totalUsed = 0;
let globalTotalUsed = 0;

// Configuration

const SHOW_PROMPT = true;
const EXTRACT_HTML = true;
const USE_BACKGROUND_INFO = true || EXTRACT_HTML;

const options = [{ label: "Background info", value: USE_BACKGROUND_INFO },
{ label: "Extract from html", value: EXTRACT_HTML },
{ label: "Show prompt", value: SHOW_PROMPT }]

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

// Prompts

const createPrompt1 = (title) => {
  return `rédige une table des matières très détaillée pour un article sur le sujet : ${titre}\nNe pas prévoir une partie Introduction\nNe pas prévoir une partie Conclusion.`
}

const createPrompt11 = (titre, outputPrompt1) => {
  return `Pour un article sur le sujet : ${titre} Repete cette table des matières : ${outputPrompt1}\nRéfléchis à des améliorations qui pourraient être apportées à ce sommaire pour qu'il soit plus complet et plus efficace.`
}

const createPrompt2 = (titre, outputPrompt11) => {
  return `rédige une intro jusqu'à 80 mots pour le post de blog : ${titre}.`
}

const createPrompt3 = (titre, outputPrompt1) => {
  return `rédige une <meta description> jusqu'à 30 mots pour le post de blog : : ${titre}\nMettre un majuscule en début de phrase\nne pas dépasser les 155 caractères maximum.`
}

// Reformule background
const createPrompt31 = (backgroundInfo) => {
  return `Reformule ce texte en français :\n"${backgroundInfo}"\n\nTexte reformulé :`
}

// infos-clés du background reformulé
const createPrompt311 = (backgroundInfo) => {
  return `Quels sont les informations clés de ce texte: :\n"${backgroundInfo}"\n\nJusque 10 informations clés : 1.`
}

//Sujet étant les différents élements du prompt 1
const createPrompt4 = (titre, sujet, level = 2) => {
  let background = USE_BACKGROUND_INFO && backgroundInfo ? `INFORMATIONS CLES : 1.${backgroundInfo}\n\n` : '';
  return `SUJET DE L'ARTICLE : ${titre}\n\nSUJET DU PARAGRAPHE : ${sujet}\n\n${background}\n\nutilise les INFORMATIONS CLES pour rédiger un paragraphe utile et passionnant sur le sujet ${sujet}\nutilise toujours des mots de liaisons\nn'ajoute pas de <h1>\nn'ajoute pas de <h2>\najoute un texte d’introduction\najoute toujours des sous-titres <h${level + 1}>\nutilise toujours des balises <p>\ntraduire les mots anglais en français\n
PARAGRAPHE ${sujet} :`
}

const createPrompt5 = (titre, outputPrompt1) => {
  return `rédige un texte de conclusion pour un article sur le sujet : ${titre}.\nCONCLUSION : `
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

const csvHeader = [
  { id: 'title', title: 'Title' },
  { id: 'full', title: 'Full Text' },
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
    { id: 'full', title: 'Full Text' },
    { id: 'regex', title: 'Regex Used' },
  ],
  append: true,
});


function removeTagFromHtml(html) {
  if (html && !!html.trim()) {
    const { JSDOM } = jsdom;
    const document = new JSDOM("").window.document;
    let div = document.createElement("div");
    div.innerHTML = html.trim();
    return div.textContent || div.innerText || "";
  }
  return "";
}

function getTitlesFromFile() {
  const html = fs.readFileSync(DEFAULT_HTML_PATH, "utf8")
  if (html && !!html.trim()) {
    const { JSDOM } = jsdom;
    const document = new JSDOM(html).window.document;
    let res = [];
    for (let i = 1; i < 4; i++) {
      const target = `h${i}`;
      const matches = Array.from(document.querySelectorAll(target));
      //console.log(`${target}:`);
      //console.log(matches.map((e) => e.textContent).filter((e) => e?.trim()).join('\n'));
      res = [...res, ...matches.map((e) => {
        //console.log("======")
        //console.log(e.textContent)
        //console.log(html.indexOf(e.innerHTML))
        //console.log("======")
        let next = e.nextElementSibling
        let text = ''
        while (next && !next.tagName.startsWith('H')) {
          if (next?.innerHTML.match(/<h\d>/)) {
            const div = document.createElement("div");
            div.innerHTML = next?.innerHTML.split(/<h\d>/)[0]
            text += div.textContent;
            break;
          } else {
            //console.log(next?.textContent)
            //console.log("===", next.tagName)
            text += next?.textContent;
          }
          next = next.nextElementSibling;
        }
        //console.log(text)
        return { position: html.indexOf(e.innerHTML), title: e.textContent, tag: e.tagName, paragraph: text }
      })];
    }
    return res.filter((e) => e.title?.trim() && e.paragraph?.trim()).sort((a, b) => a.position - b.position);
  }
  return null;
}

function getTableMatiere(extractArray) {
  const lastIndex = [0, 0, 0];
  return extractArray.filter((e) => e.tag !== 'H1').map((e) => {
    let index = "";
    if (e.tag === 'H2') {
      lastIndex[0]++
      lastIndex[1] = 0
      lastIndex[2] = 0
      index = lastIndex[0];
    }
    if (e.tag === 'H3') {
      lastIndex[1]++
      lastIndex[2] = 0
      index = `${lastIndex[0]}.${lastIndex[1]}`;
    }
    /*if (e.tag === 'H3') {
      lastIndex[2]++
      index = `${lastIndex[0]}.${lastIndex[1]}.${lastIndex[2]}`;
    }*/
    return `${index}. ${e.title}`;
  }).join('\n');
}

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

function levenshteinDistance(str1 = '', str2 = '') {
  const track = Array(str2.length + 1).fill(null).map(() =>
    Array(str1.length + 1).fill(null));
  for (let i = 0; i <= str1.length; i += 1) {
    track[0][i] = i;
  }
  for (let j = 0; j <= str2.length; j += 1) {
    track[j][0] = j;
  }
  for (let j = 1; j <= str2.length; j += 1) {
    for (let i = 1; i <= str1.length; i += 1) {
      const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
      track[j][i] = Math.min(
        track[j][i - 1] + 1, // deletion
        track[j - 1][i] + 1, // insertion
        track[j - 1][i - 1] + indicator, // substitution
      );
    }
  }
  return track[str2.length][str1.length];
};

function levenshteinSimilarity(distance, str1, str2) {
  return Math.ceil(((1-(distance/(Math.max(str1.length, str2.length)))) *100));
}

async function asyncGetUrlHTML(url) {
  const response = await fetch('https://www.biendecheznous.be/legumes/conservation/tomate');
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

  const res = [];
  const saved = [];

  let extract = [];
  let tableMatiere = "";
  
  /*
  const str1 = 'hittingazeza';
  const str2 = 'kitten';
  const distanceLevenshtein = levenshteinDistance(str1, str2)
  console.log(distanceLevenshtein, levenshteinSimilarity(distanceLevenshtein, str1, str2), "%");
  */

  if (EXTRACT_HTML) {
    extract = getTitlesFromFile();
    tableMatiere = getTableMatiere(extract);
    extractFiltered = extract.filter((e) => e.tag !== 'H1')

    console.log(tableMatiere)
    separator();
  }

  const checkOptions = prompt(`Récap des options:\n\n${options.map((o) => `${o.label} : ${o.value}`).join('\n')}\n\nVoulez-vous continuer avec ces options ? (Réponse: Oui/Non)`);
  if (!isPromptYes(checkOptions)) {
    return;
  }

  for (let i = 0; i < titres.length; i++) {
    console.log(`-- ${new Date().toLocaleString('fr')} --`)
    console.log(`-- Génération du contenu ${i + 1} sur ${titres.length} --`);
    let { title: titre } = titres[i];

    let text = "";
    if (!EXTRACT_HTML) {
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
        if (EXTRACT_HTML) {
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

        aiPrompt = createPrompt4(deepth > 2 ? deepthParent[deepth - 1] : titre, formatedSubject, deepth);
        if (deepthNext > deepth) {
          aiPrompt = createPrompt2(formatedSubject);
        }
        let sectionText = await asyncCallOpenAI(aiPrompt);

        // Levenshtein
        str1 = extractFiltered[i].paragraph;
        str2 = sectionText;
        const distanceLevenshtein = levenshteinDistance(str1, str2);
        const percentLevenshtein = levenshteinSimilarity(distanceLevenshtein, str1, str2);
        separator();
        console.log(str1);
        console.log("\nVS\n");
        console.log(str2);
        separator();
        console.log("Résultat Levenshtein :",distanceLevenshtein, `${percentLevenshtein}%`);
        separator();
        
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
    const conclusionText = await asyncCallOpenAI(aiPrompt);
    console.log("conclusionText")
    console.log(conclusionText)
    separator();

    separator();
    const concat = [metaDescriptionText, introText, tableMatsFinal, subjectsData.join('\n'), conclusionText].join('\n')
    separator();

    const datas = {
      title: titre,
      full: concat,
      token: totalUsed,
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
}());
