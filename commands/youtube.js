const { youTubeAPIKey } = require('../apitokens.json');
const YouTube = require('discord-youtube-api');
const youtube = new YouTube(youTubeAPIKey);


module.exports = {
  name: 'youtube',
  aliases: ['yt'],
  description() {return 'Searches youtube and links the first result. If you use a video id it will link directly to the video.';},
  cooldown: 5,
  usage: '[search query]',
  execute(message, args) {
    async function vidsearch() {
      if (!args.length) {
        message.channel.send('You need to provide something to search for!');
      }
      else {
        const video = await youtube.searchVideos(args.join(' '));
        message.channel.send('Here is what I found when I searched Youtube for \'' + args.join(' ') + '\': \n' + video.url + ' [' + video.length + ']');
      }
    }
    vidsearch();
  },
};