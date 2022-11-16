const { MessageEmbed } = require('discord.js');
const imdb = require('imdb-api');
const { imdbAPIKey } = require('../apitokens.json');
const cli = new imdb.Client({ apiKey: imdbAPIKey });
// TODO convert to embed for output
// TODO search func

module.exports = {
  name: 'film',
  aliases: ['f,movie'],
  description() { return 'Searches IMDB for a movie and returns the first result.';},
  cooldown: 5,
  usage(config) {
    return `[search query] (year) - Returns the first result. The year is optional but useful for ambiguous titles.
  ${config.prefix}film --search [query] (year) - Returns the top 5 search results for a string.  Year is optional.`;
  },
  async execute(message, args) {
    const outputEmbed = new MessageEmbed;
    if (!args.length) {
      message.channel.send('You need to provide something to search for!');
    }
    else if(args[0].toLowerCase() != '--search') {
      const imdbLogo = 'https://m.media-amazon.com/images/G/01/imdb/images-ANDW73HA/favicon_iPhone_retina_180x180._CB1582158069_.png';
      try {
        let year = false;
        if (args[args.length - 1].match(/\((\d*)\)/)) {
          year = args.pop().match(/\((\d*)\)/)[1];
        }
        const imdbObj = await cli.get({ name: args.join(' '), year: year, short_plot: 'short' });
        // console.log(imdbObj);
        outputEmbed
          .setTitle(`${imdbObj.title} (${imdbObj.year})`)
          .setURL(imdbObj.imdburl)
          .setThumbnail(imdbObj.poster)
          .setAuthor({ name: 'imdb', iconURL: imdbLogo })
          .setDescription(`**Director:** ${imdbObj.director}
          **Country:** ${imdbObj.country}
          **Runtime:** ${imdbObj.runtime}
          **Genres:** ${imdbObj.genres}

          ${imdbObj.plot}`);
        message.channel.send({ embeds: [outputEmbed] });
      }
      catch(err) {
        console.log(err);
        if (err.message.startsWith('Movie not found!')) {
          message.channel.send({ content: `I could not find a movie called  '${args.join(' ')}'.` });
        }
        else {
          console.log(err);
          message.reply('I\'m sorry, there was an error processing your query. Please have the bot administrator check the logs, or try again.');
        }
      }
    }
    else if(args[0].toLowerCase() == '--search') {
      args;
    }
  },
};