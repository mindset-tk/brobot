const { ytAPIkey } = require('../config.json');
const YouTube = require('discord-youtube-api');
const youtube = new YouTube(ytAPIkey);


module.exports = {
  name: 'yt',
  aliases: ['youtube'],
  description: 'Searches youtube and links the first result. If you use a video id it will link directly to the video. Performing the command without arguments will link TLO Roll Call.',
  cooldown: 5,
  usage: '[search query]',
  execute(message, args, client, msgguildid) {
    async function vidsearch() {
      if (!args.length && msgguildid == '598939818600300550') {
        const video = await youtube.searchVideos('j5y3NQi_RAY');
        message.channel.send(video.url + ' [' + video.length + ']');
      }
      else if (!args.length) {
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