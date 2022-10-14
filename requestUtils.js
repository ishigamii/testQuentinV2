const fetch = require('node-fetch');

function getYoutubeVideo(title) {
  return fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&q=${title}&key=AIzaSyAsz6fIGOe4LJsWmGXK6-np7gfpfqsfCdY`)
    .then(response => {
      return response.json()
    })
    .then(data => {
      //resTxt.innerText = JSON.stringify(data.items[1].id.videoId, null, 2);
      const videoid = JSON.stringify(data.items[0].id.videoId).replaceAll('"', "");
      const youtubeURL = `https://www.youtube.com/watch?v=${videoid}`
      return youtubeURL;
    })
}


/*
{
    "total":33466,
    "totalHits":500,
    "hits":[
        {
            "id":2295434,
            "pageURL":"https://pixabay.com/photos/spring-bird-bird-tit-spring-blue-2295434/",
            "type":"photo",
            "tags":"spring bird, bird, tit",
            "previewURL":"https://cdn.pixabay.com/photo/2017/05/08/13/15/spring-bird-2295434_150.jpg",
            "previewWidth":150,
            "previewHeight":99,
            "webformatURL":"https://pixabay.com/get/g0a5a2918e5214a7f85e6e17732d64f934062b8ece30ee33b9a6fa98b635e78deadc6f1dd18979f817acfc384b5705dfe12b93af8750df63d69141615bfdf12ce_640.jpg",
            "webformatWidth":640,
            "webformatHeight":426,
            "largeImageURL":"https://pixabay.com/get/g90ae8faeb35a26f14c9402362535b96d31158e7aee559fb3d78c9339039239707b5780c3c78818932114066e1ee1d39bd2287e0729f1a6d275ec3a96e9273718_1280.jpg",
            "imageWidth":5363,
            "imageHeight":3575,
            "imageSize":2938651,
            "views":546586,
            "downloads":307550,
            "collections":1985,
            "likes":1924,
            "comments":237,
            "user_id":334088,
            "user":"JillWellington",
            "userImageURL":"https://cdn.pixabay.com/user/2018/06/27/01-23-02-27_250x250.jpg"
        },
*/

/**
* @param title keyword search
* @param imageSize "150" | "640" | "1280" (par défault 1280)
*/
async function getPixabayImage(title, imageSize = "1280") {
  return fetch(`https://pixabay.com/api/?key=28679839-433c36903652bde56d17510b7&q=${title}&image_type=photo&pretty=true&orientation="horizontal"`)
    .then(response => {
      return response.json()
    })
    .then(data => {
      if (data.hits?.length > 0) {
        const hit = data.hits[0];
        let imageURL = null;
        if (imageSize === "1280") {
          imageURL = hit.largeImageURL;
        }
        if (imageSize === "640") {
          imageURL = hit.webformatURL;
        }
        if (imageSize === "150") {
          imageURL = hit.previewURL;
        }
        return imageURL;
      }
      return null;
    })
}

exports.getYoutubeVideo = getYoutubeVideo;
exports.getPixabayImage = getPixabayImage;