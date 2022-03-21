const { MessageEmbed } = require('discord.js');
const md5 = require('md5');
const wiki = require('wikijs').default;

// TODO convert to embed for output

module.exports = {
  name: 'wiki',
  aliases: ['w'],
  description() {return 'Links a wikipedia article with a given title.  If no exact match is found, lists the top 5 results from a wiki search.';},
  cooldown: 5,
  usage() {return '[search query]';},
  async execute(message, args) {
    async function searchWikipedia() {
      const outputEmbed = new MessageEmbed;
      if (!args.length) {
        message.channel.send('You need to provide something to search for!');
      }
      else {
        let wikiLogo = wiki().api({ action: 'query', meta: 'siteinfo' }).then(info => {return ('https:' + info.query.general.logo);});
        try {
          const wikiArticle = await wiki().page(args.join(' '));
          let summary = wikiArticle.summary().then(sum => {
            const sumArr = sum.split('\n');
            // take the first paragraph no matter what, then add additional paras until the length is approx. 1024 characters.
            let sumStr = sumArr.shift();
            for (const e of sumArr) {
              if ((sumStr + '\n' + e).length > 1025) {
                break;
              }
              else {
                sumStr += ('\n' + e);
              }
            }
            if (sumStr.endsWith('\n')) sumStr = sumStr.slice(0, -1);
            if (sumStr.length > 1) return sumStr;
            else return sum.slice(0, 1024);
          });
          let thumbnailImg = wikiArticle.mainImage();
          await Promise.all([summary, thumbnailImg, wikiLogo]).then(arr => {
            summary = arr[0];
            thumbnailImg = arr[1];
            wikiLogo = arr[2];
          }).then(() => {
            if (thumbnailImg.endsWith('.svg')) {
              // mediawiki stores the png version of a file
              let filename = thumbnailImg.split('/').pop();
              filename = filename.replace(' ', '_');
              const hash = md5(filename);
              thumbnailImg = `https://upload.wikimedia.org/wikipedia/commons/thumb/${hash.slice(0, 1)}/${hash.slice(0, 2)}/${filename}/300px-${filename}.png`;
            }
          });
          outputEmbed
            .setTitle(wikiArticle.title)
            .setURL(wikiArticle.fullurl)
            .setThumbnail(thumbnailImg)
            .setAuthor({ name: 'Wikipedia', iconURL: wikiLogo })
            .setDescription(summary);
          message.channel.send({ embeds: [outputEmbed] });
        }
        catch(err) {
          if (err.message == 'No article found') {
            const searchResults = await wiki().search(args.join(' ')).then((r) => {return r.results.slice(0, 5);});
            const linkArr = [];
            const articleArr = [];
            let i = 0;
            for (const title of searchResults) {
              const article = wiki().page(title);
              articleArr.push(article);
            }
            await Promise.all([wikiLogo, ...articleArr]).then(values => {
              wikiLogo = values.shift();
              values.forEach(a =>{
                i++;
                linkArr.push(`${i}. [${a.title}](${a.fullurl})`);
              });
            });
            outputEmbed
              .setAuthor({ name: 'Wikipedia', iconURL: wikiLogo })
              .setTitle(`Top ${linkArr.length} search results`)
              .setDescription(linkArr.join('\n'));
            message.channel.send({ content: `I could not find an article called  '${args.join(' ')}'.`, embeds: [outputEmbed] });
          }
          else {
            console.log(err);
            message.reply('I\'m sorry, there was an error processing your query. Please have the bot administrator check the logs, or try again.');
          }
        }
      }
    }
    searchWikipedia();
  },
};