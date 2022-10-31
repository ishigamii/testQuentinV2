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
const EXTRACT_HTMLS = false;
const USE_BACKGROUND_INFO = false || EXTRACT_HTML || EXTRACT_HTMLS;
const REWRITE_PRODUCTS = true;
const LEVENSHTEIN_PERCENT = 65; // percent max otherwise we reload
const LEVENSHTEIN_MAX_RETRY = 2; // number max of retry 

const options = [{ label: "Background info", value: USE_BACKGROUND_INFO },
{ label: "Extract from html", value: EXTRACT_HTML },
{ label: "Extract from csv htmls", value: EXTRACT_HTMLS },
{ label: "Show prompt", value: SHOW_PROMPT },
{ label: "Levenshtein percent", value: LEVENSHTEIN_PERCENT },
{ label: "Levenshtein max retry", value: LEVENSHTEIN_MAX_RETRY }]

const startDate = new Date("2022-08-01 8:00");
const intervaleHour = "12";
const outputFormat = "YYYY-MM-DD HH:mm";

// OpenAi
const frequency_multiplier_default = 3;
let frequency_multiplier = 3;
const presence_multiplier_default = 2;
let presence_multiplier = 2;

const regexTable = /^\s*(\d\s?(\.|\)))*\s*/;

const DEFAULT_TABLE_CONTENT_PATH = "tableContent.txt";

// Background infos
const DEFAULT_BACKGROUND_INFO_PATH = "backgroundinfo.txt";
const DEFAULT_BACKGROUND_INFO_PATH_OLD = "backgroundinfo_old.txt";
let backgroundInfo = fs.readFileSync(DEFAULT_BACKGROUND_INFO_PATH, "utf8")

// HTML file base
const DEFAULT_HTML_PATH = 'html.txt';
const DEFAULT_HTMLS_PATH = 'htmls.csv';

// Products fils
const DEFAULT_PRODUCTS_PATH = 'product_export.csv';

// Levenshtein
const DEFAULT_LEVENSHTEIN_PATH = "levenshteinMore65.txt";

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
  return `Quels sont les informations clés de ce texte: \n"${backgroundInfo}"\n\nJusque 10 informations clés : -`
}

//Sujet étant les différents élements du prompt 1
//VERSION SANS TEXTE INTRO + SOUS TITRES
const createPrompt4 = (titre, sujet, level = 2) => {
  let background = USE_BACKGROUND_INFO && backgroundInfo ? `INFORMATIONS CLES : -${backgroundInfo}\n\n` : '';
  return `SUJET DE L'ARTICLE : ${titre}\n\nSUJET DU PARAGRAPHE : ${sujet}\n\n${background}\n\nrédige un paragraphe engageant et très détaillé en français\nutilise toujours des mots de liaisons\najoute des transitions entre les phrases\nn'ajoute pas de <h1>\ntraduire les mots anglais en français\n
PARAGRAPHE ENGAGEANT :`
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

// Prompt to rework Title
const createPromptReworkTitle = (title) => {
  return `paraphrase complètement ce titre produit afin de le rendre plus court et impactant : "${title}"\n\nTitre paraphrasé :`
}

const createPromptReworkDescription1 = (description) => {
  return `Quels sont les informations clés de ce texte: :\n"${description}"\n\nJusque 10 informations clés : -`
}

const createPromptReworkDescription2 = (description) => {
  return `paraphrase totalement en français chaque phrase du texte suivant : "${description}"\nutilise un ton engageant\nConserve toujours les accents\n\nTexte engageant reformulé :`
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

const productUrls = [];
const csvProducts = fs.createReadStream(DEFAULT_PRODUCTS_PATH)
  .pipe(csv())
  .on('data', (row) => {
    productUrls.push({ ...row });
  })

const csvProductsEnd = new Promise(function(resolve, reject) {
  csvProducts.on('end', () => {
    console.log('CSV file successfully processed');
    resolve(productUrls);
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

const csvHeaderRework = [
  { id: 'url', title: 'URL' },
  { id: 'description', title: 'Description' },
];

const csvHeaderProductsFull = ["post_title",
  "post_name",
  "post_parent",
  "ID",
  "post_content",
  "post_excerpt",
  "post_status",
  "post_password",
  "menu_order",
  "post_date",
  "post_author",
  "comment_status",
  "sku",
  "parent_sku",
  "children",
  "downloadable",
  "virtual",
  "stock",
  "regular_price",
  "sale_price",
  "weight",
  "length",
  "width",
  "height",
  "tax_class",
  "visibility",
  "stock_status",
  "backorders",
  "sold_individually",
  "low_stock_amount",
  "manage_stock",
  "tax_status",
  "upsell_ids",
  "crosssell_ids",
  "purchase_note",
  "sale_price_dates_from",
  "sale_price_dates_to",
  "download_limit",
  "download_expiry",
  "product_url",
  "button_text",
  "images",
  "downloadable_files",
  "product_page_url",
  "meta:total_sales",
  "meta:_yoast_wpseo_focuskw",
  "meta:_yoast_wpseo_canonical",
  "meta:_yoast_wpseo_bctitle",
  "meta:_yoast_wpseo_meta-robots-adv",
  "meta:_yoast_wpseo_is_cornerstone",
  "meta:_yoast_wpseo_metadesc",
  "meta:_yoast_wpseo_linkdex",
  "meta:_yoast_wpseo_estimated-reading-time-minutes",
  "meta:_yoast_wpseo_content_score",
  "meta:_yoast_wpseo_title",
  "meta:_yoast_wpseo_metakeywords",
  "tax:product_type",
  "tax:product_visibility",
  "tax:product_cat",
  "tax:product_tag",
  "tax:product_shipping_class",
  "attribute:Batteries Piles requises",
  "attribute_data:Batteries Piles requises",
  "attribute_default:Batteries Piles requises",
  "attribute:CN",
  "attribute_data:CN",
  "attribute_default:CN",
  "attribute:Caractères",
  "attribute_data:Caractères",
  "attribute_default:Caractères",
  "attribute:Characters",
  "attribute_data:Characters",
  "attribute_default:Characters",
  "attribute:Composants",
  "attribute_data:Composants",
  "attribute_default:Composants",
  "attribute:Composition",
  "attribute_data:Composition",
  "attribute_default:Composition",
  "attribute:Conseils dentretien",
  "attribute_data:Conseils dentretien",
  "attribute_default:Conseils dentretien",
  "attribute:Date de mise en ligne sur Amazon.fr",
  "attribute_data:Date de mise en ligne sur Amazon.fr",
  "attribute_default:Date de mise en ligne sur Amazon.fr",
  "attribute:Department Name",
  "attribute_data:Department Name",
  "attribute_default:Department Name",
  "attribute:Dimensions du colis",
  "attribute_data:Dimensions du colis",
  "attribute_default:Dimensions du colis",
  "attribute:Dimensions du produit L x l x h",
  "attribute_data:Dimensions du produit L x l x h",
  "attribute_default:Dimensions du produit L x l x h",
  "attribute:Disponibilité des pièces détachées",
  "attribute_data:Disponibilité des pièces détachées",
  "attribute_default:Disponibilité des pièces détachées",
  "attribute:Fabricant",
  "attribute_data:Fabricant",
  "attribute_default:Fabricant",
  "attribute:Langue",
  "attribute_data:Langue",
  "attribute_default:Langue",
  "attribute:Marque",
  "attribute_data:Marque",
  "attribute_default:Marque",
  "attribute:Materiau dextérieur",
  "attribute_data:Materiau dextérieur",
  "attribute_default:Materiau dextérieur",
  "attribute:Matière",
  "attribute_data:Matière",
  "attribute_default:Matière",
  "attribute:Matière principale",
  "attribute_data:Matière principale",
  "attribute_default:Matière principale",
  "attribute:Matériau",
  "attribute_data:Matériau",
  "attribute_default:Matériau",
  "attribute:Nom de marque",
  "attribute_data:Nom de marque",
  "attribute_default:Nom de marque",
  "attribute:Nombre de joueurs",
  "attribute_data:Nombre de joueurs",
  "attribute_default:Nombre de joueurs",
  "attribute:Nombre de pièces",
  "attribute_data:Nombre de pièces",
  "attribute_default:Nombre de pièces",
  "attribute:Numéro de Modèle",
  "attribute_data:Numéro de Modèle",
  "attribute_default:Numéro de Modèle",
  "attribute:Numéro de modèle",
  "attribute_data:Numéro de modèle",
  "attribute_default:Numéro de modèle",
  "attribute:Numéro du modèle de larticle",
  "attribute_data:Numéro du modèle de larticle",
  "attribute_default:Numéro du modèle de larticle",
  "attribute:Origine",
  "attribute_data:Origine",
  "attribute_default:Origine",
  "attribute:Pays dorigine",
  "attribute_data:Pays dorigine",
  "attribute_default:Pays dorigine",
  "attribute:Piles incluses",
  "attribute_data:Piles incluses",
  "attribute_default:Piles incluses",
  "attribute:Poids de larticle",
  "attribute_data:Poids de larticle",
  "attribute_default:Poids de larticle",
  "attribute:Production interrompue par le fabricant",
  "attribute_data:Production interrompue par le fabricant",
  "attribute_default:Production interrompue par le fabricant",
  "attribute:Produit à monter soi-même",
  "attribute_data:Produit à monter soi-même",
  "attribute_default:Produit à monter soi-même",
  "attribute:Référence constructeur",
  "attribute_data:Référence constructeur",
  "attribute_default:Référence constructeur",
  "attribute:Référence fabricant",
  "attribute_data:Référence fabricant",
  "attribute_default:Référence fabricant",
  "attribute:Sexe",
  "attribute_data:Sexe",
  "attribute_default:Sexe",
  "attribute:Style",
  "attribute_data:Style",
  "attribute_default:Style",
  "attribute:Tranche dâge",
  "attribute_data:Tranche dâge",
  "attribute_default:Tranche dâge",
  "attribute:Type Darticle",
  "attribute_data:Type Darticle",
  "attribute_default:Type Darticle",
  "attribute:Type de Source",
  "attribute_data:Type de Source",
  "attribute_default:Type de Source",
  "attribute:Type de matériau",
  "attribute_data:Type de matériau",
  "attribute_default:Type de matériau",
  "attribute:Télécommande incluse",
  "attribute_data:Télécommande incluse",
  "attribute_default:Télécommande incluse",
  "attribute:Unités",
  "attribute_data:Unités",
  "attribute_default:Unités",
  "attribute:Utilisation spéciale",
  "attribute_data:Utilisation spéciale",
  "attribute_default:Utilisation spéciale",
  "attribute:Valeurs éducatives",
  "attribute_data:Valeurs éducatives",
  "attribute_default:Valeurs éducatives",
  "attribute:pa_color",
  "attribute_data:pa_color",
  "attribute_default:pa_color",
  "attribute:pa_couleur",
  "attribute_data:pa_couleur",
  "attribute_default:pa_couleur",
  "attribute:pa_taille",
  "attribute_data:pa_taille",
  "attribute_default:pa_taille",
  "attribute:Âge",
  "attribute_data:Âge",
  "attribute_default:Âge",
  "attribute:Âge recommandé par le fabricant",
  "attribute_data:Âge recommandé par le fabricant",
  "attribute_default:Âge recommandé par le fabricant",
  "percent_levenshtein"];

const csvWriterReworkAppend = createCsvWriter({
  path: 'productsRework.csv',
  header: csvHeaderProductsFull,
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

function sleep(milliseconds) {
  const date = Date.now();
  let currentDate = null;
  do {
    currentDate = Date.now();
  } while (currentDate - date < milliseconds);
}

async function getBestTryLevenshtein(originText, reworkText, fct, nbRetry = LEVENSHTEIN_MAX_RETRY, maxPercent = LEVENSHTEIN_PERCENT) {
  let retry = 0;
  let distanceLevenshtein = 0;
  let percentLevenshtein = 0;
  let sectionText = "";
  let best = { percent: 101, text: '' };

  // Reset frequency_multiplier
  frequency_multiplier = frequency_multiplier_default;

  do {
    sectionText = await asyncCallOpenAI(fct(reworkText));

    // Levenshtein
    str1 = originText;
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
    frequency_multiplier += 1;
  } while (percentLevenshtein > maxPercent && retry <= nbRetry);

  if (best.text) {
    sectionText = best.text;
  }

  if (best.percent > maxPercent) {
    fs.appendFileSync(DEFAULT_LEVENSHTEIN_PATH, `${originText}-${best.percent}%\n${best.text}\n`)
  }

  return best;
}

async function asyncGetUrlHTML(url) {
  let options = {};
  options.redirect = "follow";
  options.follow = 20;
  let headers = {
    'user-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36',
    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
  };
  options.headers = headers;
  const response = await fetch(url, options);
  const body = await response.text();
  //console.log(body)
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
    frequency_penalty: 0.4 * frequency_multiplier,
    presence_penalty: 0.2 * presence_multiplier,
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

  if (REWRITE_PRODUCTS) {
    let products = await csvProductsEnd;
    productsData = await Promise.all(
      products.map(async ({ post_content: url, ...rest }) => {
        const isUrl = url.startsWith("http");
        let description = url;
        if (isUrl) {
          let html = await asyncGetUrlHTML(url);
          separator();
          console.log(`- url: ${url} -`);
          separator();
          description = htmlUtils.getDescriptionFromHTML(html, url);
          separator();
        }
        description = stringUtils.removeAllTags(description);
        console.log(`- description: ${description} -`);
        return { description: description, url: url, ...rest }
      }));

    for (let j = 0; j < productsData.length; j++) {
      const { description, url, post_title, ...rest } = productsData[j];
      let title = await asyncCallOpenAI(createPromptReworkTitle(post_title));
      console.log("new title", title, "vs", post_title);
      let text = await asyncCallOpenAI(createPromptReworkDescription1(description));
      const res = await getBestTryLevenshtein(description, text, createPromptReworkDescription2);
      csvWriterReworkAppend.writeRecords([{ ...rest, post_content: res.text, post_title: title, percent_levenshtein: res.percent }])
      
      if (j % 20 === 0) {
        console.log("gonna sleep for 60s");
        sleep(60000);
      }
    }

    separator();
    console.log("Rework products END")
    separator();
    return;
  }

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
        const isUrl = url.startsWith("http");
        const res = isUrl ? await asyncGetUrlHTML(url) : url;
        let html = stop.trim() ? res.split(stop.trim())[0] : res;
        const h1Split = html.split(/<h1/i);
        if (h1Split.length > 1) {
          console.log(`Removed ${h1Split[0].length} chars from html (${h1Split.length})`)
          html = `<h1${h1Split[1]}`;
        }
        // Remove comments from html
        html = html.replaceAll(/<!--.*?-->/gi, '');
        separator();
        console.log(`- ${isUrl ? url : 'HTML'} -`);
        console.log(`- stop:${stop} - tag:${tag} -`);
        separator();
        const extract = htmlUtils.getTitlesFromHTML(html);
        console.log(extract)
        separator();
        console.log(htmlUtils.getTableMatiere(extract))
        separator();
        //TODO save extract et table matière to reuse
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

          if (best.percent > LEVENSHTEIN_PERCENT) {
            fs.appendFileSync(DEFAULT_LEVENSHTEIN_PATH, `${formatedSubject}-${best.percent}%\n${best.text}\n`)
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
      if (EXTRACT_HTMLS) {
        const imageTag = websites[j]?.tag;
        image = await requestUtils.getPixabayImage(imageTag);
        console.log(image, " for tag", imageTag);
      }
      const video = await requestUtils.getYoutubeVideo(titre, false);
      const videoText = video ? `\n<h2>Vidéo sur le sujet</h2>\n${video}` : '';

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