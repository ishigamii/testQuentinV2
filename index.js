const moment = require("moment");
const csv = require('csv-parser');
const fs = require('fs');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const { Configuration, OpenAIApi } = require("openai");
const jsdom = require("jsdom");

moment.locale('fr-fr');

let totalUsed = 0;
let globalTotalUsed = 0;

// Configuration

const SHOW_PROMPT = false;
const USE_BACKGROUND_INFO = false;

const startDate = new Date("2022-08-01 8:00");
const intervaleHour = "12";
const outputFormat = "YYYY-MM-DD HH:mm";

const regexTable = /^\s*(\d\s?(\.|\)))*\s*/;

const DEFAULT_TABLE_CONTENT_PATH = "tableContent.txt";

// Background infos
const DEFAULT_BACKGROUND_INFO_PATH = "backgroundinfo.txt";
const DEFAULT_BACKGROUND_INFO_PATH_OLD = "backgroundinfo_old.txt";
const backgroundInfo = fs.readFileSync(DEFAULT_BACKGROUND_INFO_PATH, "utf8")

// Prompts

const createPrompt1 = (title) => {
  return `rédige une table des matières très détaillée pour un article sur le sujet : ${title}\nNe pas prévoir une partie Introduction\nNe pas prévoir une partie Conclusion.`
}

const createPrompt11 = (titre, outputPrompt1) => {
  return `Pour un article sur le sujet : ${titre} Repete cette table des matières : ${outputPrompt1}\nRéfléchis à des améliorations qui pourraient être apportées à ce sommaire pour qu'il soit plus complet et plus efficace.`
}

const createPrompt2 = (titre, outputPrompt11) => {
  return `rédige une introduction jusqu'à 80 mots pour un article sur le sujet : ${titre}.`
}

const createPrompt3 = (titre, outputPrompt1) => {
  return `rédige une meta description jusqu'à 30 mots pour un article sur le sujet : ${titre} dont la table des matières est : ${outputPrompt1}\nMettre un majuscule en début de phrase\nne pas dépasser les 155 caractères maximum\nutiliser la balise <meta name="description">.`
}

// Sujet étant les différents élements du prompt 1
const createPrompt4 = (titre, sujet, level = 2) => {
  let background = USE_BACKGROUND_INFO && backgroundInfo ? `Background information : ${backgroundInfo}\n` : '';
  return `${background}rédige un paragraphe ${sujet} très détaillée pour un article sur le sujet : ${titre}\nCommence par un <h${level}>${sujet}</h${level}>\najoute ensuite un texte d’introduction\n ajoute toujours des sous-titres <h${level + 1}>\nutilise toujours des balises <p>\ntraduire les mots anglais en français.`
}

const createPrompt5 = (titre, outputPrompt1) => {
  return `rédige un texte de conclusion pour un article sur le sujet : ${titre} dont la table des matières est : ${outputPrompt1}.`
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
    frequency_penalty: 0.2,
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

  for (let i = 0; i < titres.length; i++) {
    console.log(`-- ${new Date().toLocaleString('fr')} --`)
    console.log(`-- Génération du contenu ${i + 1} sur ${titres.length} --`);
    const { title: titre } = titres[i];

    let aiPrompt = createPrompt1(titre);
    let text = "";

    while (true) {
      text = await asyncCallOpenAI(aiPrompt);
      separator();
      console.log("Ancienne génération\n", saved.join('\n'));
      separator();
      console.log(text);
      separator();
      const response = prompt("On continue avec ça ? (Réponse: Oui/Non/Combo)");

      if (["oui", 'o', 'yes', 'y'].includes(response.toLowerCase())) {
        break;
      }
      if (["combo", 'c'].includes(response.toLowerCase())) {
        saved.push(text);
        fs.writeFileSync(DEFAULT_TABLE_CONTENT_PATH, saved.join('\n'));
        const combo = prompt("Pour combiner, modifiez le fichier tableContent.txt dans l'ordre que vous souhaitez (attention de bien garder les . derrières les chiffres ex: 1. / 1.1. / 1.2.3. ) puis répondez oui.");
        if (["oui", 'o', 'yes', 'y'].includes(combo.toLowerCase())) {
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
    for (let i = 0; i < subjects.length; i++) {
      separator();
      const deepth = getDeepth(subjects[i]);
      const deepthNext = getDeepth(subjects[i + 1]);
      const formatedSubject = subjects[i].replace(regexTable, "")
      deepthParent[deepth] = formatedSubject;
      console.log(formatedSubject)
      separator();
      if (formatedSubject) {
        aiPrompt = createPrompt4(deepth > 2 ? deepthParent[deepth - 1] : titre, formatedSubject, deepth);
        if (deepthNext > deepth) {
          aiPrompt = createPrompt2(formatedSubject);
        }
        let sectionText = await asyncCallOpenAI(aiPrompt);
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

