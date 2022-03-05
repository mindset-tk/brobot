const { MessageEmbed } = require('discord.js');

const wiki = require('wikijs').default;

// TODO convert to embed for output

module.exports = {
  name: 'wiki',
  aliases: ['w'],
  description() {return 'Links a wikipedia article with a given title.  If no exact match is found, lists the top 5 results from a wiki search.';},
  cooldown: 5,
  usage() {return '[search query]';},
  execute(message, args) {
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
            let sumStr = '';
            for (const e of sumArr) {
              if ((sumStr + '\n' + e).length < 1025) {
                sumStr += ('\n' + e);
              }
            }
            if (sumStr.startsWith('\n')) sumStr = sumStr.slice(1);
            if (sumStr.endsWith('\n')) sumStr = sumStr.slice(0, -1);
            if (sumStr.length > 1) return sumStr;
            else return sumArr[0].slice(0, 1024);
          });
          let thumbnailImg = wikiArticle.mainImage();
          await Promise.all([summary, thumbnailImg, wikiLogo]).then(arr => {
            summary = arr[0];
            thumbnailImg = arr[1];
            wikiLogo = arr[2];
          }).then(() => {
            if (thumbnailImg.endsWith('.svg')) {
              const img = wiki().api({ action: 'query', prop: 'pageimages', titles: wikiArticle.title, pithumbsize: 200 });
              thumbnailImg = img.query.pages[Object.keys(img.query.pages)[0]].thumbnail.source;
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