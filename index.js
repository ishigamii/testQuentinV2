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

const startDate = new Date("2022-08-01 8:00");
const intervaleHour = "12";
const outputFormat = "YYYY-MM-DD HH:mm";

// Prompts

const createPrompt1 = (title) => {
  return `rédige une table des matières très détaillée pour un article sur le sujet : ${title}\nNe pas prévoir une partie Introduction\nNe pas prévoir une partie Conclusion.`
}

const createPrompt11 = (titre, outputPrompt1) => {
  return `Pour un article sur le sujet : ${titre} Repete cette table des matières : ${outputPrompt1}\nRéfléchis à des améliorations qui pourraient être apportées à ce sommaire pour qu'il soit plus complet et plus efficace.`
}

const createPrompt2 = (titre, outputPrompt11) => {
  return `rédige un texte d'introduction pour un article sur le sujet : ${titre} qui présente la table des matières : ${outputPrompt11}.`
}

const createPrompt3 = (titre, outputPrompt1) => {
  return `rédige un texte de balise <meta name="description"> d'une longeur maximum de 155 caractères pour un article sur le sujet : ${titre} dont la table des matières est : ${outputPrompt1}\nMettre un majuscule en début de phrase\nne pas dépasser les 155 caractères maximum.`
}

// Sujet étant les différents élements du prompt 1
const createPrompt4 = (titre, sujet) => {
  return `rédige un paragraphe ${sujet} très détaillée pour un article sur le sujet : ${titre}\nCommence par un <h2>${sujet}</h2>\najoute ensuite un texte d’introduction\n ajoute toujours des sous-titres <h3>\nutilise toujours des balises <p>\ntraduire les mots anglais en français.`
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

async function asyncCallOpenAI(prompt) {
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

  /*
  const response = prompt("T'es content ?");

  if (response.toLowerCase() === "oui" || 'o') {
    console.log("gogog")
  } else {
    console.log("STOP")
  }
  */

  for (let i = 0; i < titres.length; i++) {
    console.log(`-- ${new Date().toLocaleString('fr')} --`)
    console.log(`-- Génération du contenu ${i + 1} sur ${titres.length} --`);
    const { title: titre } = titres[i];

    let prompt = createPrompt1(titre);
    let text = await asyncCallOpenAI(prompt);
    for (let i = 0; i < 2; i++) {
      separator();
      console.log(text);
      prompt = createPrompt11(titre, text);
      text = await asyncCallOpenAI(prompt);
    }

    separator();
    let tableMatsFinal = text.replace("Table des matières", '').replaceAll("\n\n", '\n')
    console.log(tableMatsFinal);

    separator();
    prompt = createPrompt2(titre, tableMatsFinal);
    const introText = await asyncCallOpenAI(prompt);
    console.log("introText")
    console.log(introText)
    separator();

    separator();
    prompt = createPrompt3(titre, tableMatsFinal);
    const metaDescriptionText = await asyncCallOpenAI(prompt);
    console.log("metaDescriptionText")
    console.log(metaDescriptionText)
    separator();

    const subjects = tableMatsFinal.split('\n').filter(t => t.trim());
    console.log(subjects)
    const subjectsData = []
    for (let i = 0; i < subjects.length; i++) {
      separator();
      const formatedSubject = subjects[i].replace(/^(\d\s?(\.|\)))*\s?/, "")
      console.log(formatedSubject)
      separator();
      if (formatedSubject) {
        prompt = createPrompt4(titre, formatedSubject);
        const sectionText = await asyncCallOpenAI(prompt);
        if( !sectionText.includes("<h2>") ) {
          sectionText = `<h2>${formatedSubject}</h2>`
        }
        console.log(sectionText)
        subjectsData.push(sectionText);
      }
    }

    //console.log(subjectsData)

    separator();
    prompt = createPrompt5(titre, tableMatsFinal);
    const conclusionText = await asyncCallOpenAI(prompt);
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
}());