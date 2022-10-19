function removeEmoji(text) {
  return text.replace(/([\uE000-\uF8FF]|\uD83C[\uDF00-\uDFFF]|\uD83D[\uDC00-\uDDFF])/g, '');
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
  return Math.ceil(((1 - (distance / (Math.max(str1.length, str2.length)))) * 100));
}

function escapeHtml(unsafe) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function countOccurenceOfString(string, substring, wordOnly = true) {
  let regex = null;
  if (wordOnly) {
    regex = new RegExp(`\\b${substring}\\b`, "gi");
  } else {
    regex = new RegExp(substring, "gi");
  }
  const occurences = (string.match(regex) || []).length;
  return occurences;
}

function getIndexesOfString(string, substring, wordOnly = true) {
  const message = string;
  let msg = message;
  let indexes = [];

  let regex = null;
  if (wordOnly) {
    regex = new RegExp(`\\b${substring}\\b`, "gi");
  } else {
    regex = new RegExp(substring, "gi");
  }

  do {
    const index = msg.search(regex);
    indexes.push(index);
    msg = msg.substring(index + 2);
  } while (msg.search(regex) !== -1)
  return indexes;
}

function replaceTooOften(text, substring, maxOccurences, replaceByArray, wordOnly = true) {
  const occurences = countOccurenceOfString(text, substring);

  if (occurences >= maxOccurences) {
    const indexes = getIndexesOfString(text, substring);

    // keep first occurence
    const beforeText = text.slice(0, indexes[0] + substring.length);
    let afterText = text.slice(indexes[0] + substring.length);

    let regex = null;
    if (wordOnly) {
      regex = new RegExp(`\\b${substring}\\b`, "i");
    } else {
      regex = new RegExp(substring, "i");
    }

    // Replace all the other with random word from replaceByArray
    while (afterText.search(regex) !== -1) {
      afterText = afterText.replace(regex, replaceByArray[Math.floor(Math.random() * replaceByArray.length)]);
    }

    return `${beforeText}${afterText}`
  }

  return text;
}

exports.removeEmoji = removeEmoji;
exports.levenshteinDistance = levenshteinDistance;
exports.levenshteinSimilarity = levenshteinSimilarity;
exports.escapeHtml = escapeHtml;
exports.countOccurenceOfString = countOccurenceOfString;
exports.getIndexesOfString = getIndexesOfString;
exports.replaceTooOften = replaceTooOften;