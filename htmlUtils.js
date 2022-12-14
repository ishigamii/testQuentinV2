const jsdom = require("jsdom");
const stringUtils = require('./stringUtils');

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

function getDescriptionFromHTML(html, url) {
  let res = "";
  if (html && !!html.trim()) {
    const { JSDOM } = jsdom;
    const document = new JSDOM(html).window.document;
    if (url.startsWith('https://www.amazon.fr')) {
      const matches = Array.from(document.querySelectorAll("h2"));
      const match = matches.find((m) => m.innerHTML.includes("Description du produit"))
      let next = match.nextElementSibling;
      res = (next?.textContent || next?.value || '').trim();
    }
  }
  return res;
}

/**
* @param html The html
* @param maxHeaderNumber max header number not included if 4 will only take h1/h2/h3
*/
function getTitlesFromHTML(html, maxHeaderNumber = 7) {
  if (html && !!html.trim()) {
    const { JSDOM } = jsdom;
    const document = new JSDOM(html).window.document;
    const body = document.body.innerHTML;
    //console.log(document, body)
    let res = [];
    for (let i = 1; i < maxHeaderNumber; i++) {
      const target = `h${i}`;
      const matches = Array.from(document.querySelectorAll(target));
      //console.log(`${target}:`);
      //console.log(matches.map((e) => e.textContent).filter((e) => e?.trim()).join('\n'));
      res = [...res, ...matches.map((e) => {
        /*console.log("======")
        console.log(e.textContent)
        console.log(body.indexOf(e.outerHTML))
        console.log("======")*/
        //let next = e.nextElementSibling // for only Element
        let next = e.nextSibling // for Element and direct text
        let text = ''
        while (next && !next?.tagName?.startsWith('H')) {
          if (next?.innerHTML?.match(/<h\d>/)) {
            const div = document.createElement("div");
            div.innerHTML = next?.innerHTML.split(/<h\d>/)[0]
            text += div.textContent;
            break;
          } else {
            //console.log(next?.textContent)
            //console.log(next?.value)
            //console.log("===", next?.tagName ?? next)
            
            // Maybe next?.innerText would be nicer
            text += (next?.textContent || next?.value || '').trim();
          }
          //next = next.nextElementSibling;
          next = next.nextSibling;
        }
        //console.log("Text found: ", text )
        //console.log("\nSans emoji:",  stringUtils.removeEmoji(text))
        return { position: body.indexOf(e.outerHTML), title: stringUtils.removeEmoji(e.textContent?.trim()), tag: e.tagName, paragraph: stringUtils.removeEmoji(text) }
      })];
    }
    return res.filter((e) => e.title?.trim() || e.paragraph?.trim()).sort((a, b) => a.position - b.position);
  }
  return null;
}

/**
* @param extractArray output of getTitlesFromHTML
*/
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

exports.removeTagFromHtml = removeTagFromHtml;
exports.getTitlesFromHTML = getTitlesFromHTML;
exports.getTableMatiere = getTableMatiere;
exports.getDescriptionFromHTML = getDescriptionFromHTML;