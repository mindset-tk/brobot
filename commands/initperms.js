const path = require('path');
const configPath = path.resolve('./config.json');
const config = require(configPath);


module.exports = {
  name: 'initperms',
  description: 'resets/initializes permissions on a channel or category; useful if a channel or category has bad permissions. Use without arguments to initialize the \
current channel, or !initperms <#channel> to initialize a different channel from the one you are currently in. Add -category at the end to initialize permissions on the \
parent category of a channel (does not affect permissions of the channel itself unless they are inherited)\
\n\n**NOTE:** If targeting a private channel this will make the channel public!',
  usage: '<#channel> <-category>',
  guildOnly: true,
  guildLimit: ['598939818600300550'],
  execute(message, args, client, msgguildid) {
    let targetchannel;
    let targetcategory;
    let cat;
    const guild = message.guild;
    if (!message.member.roles.cache.has(config[msgguildid].roleUser)) {
      message.channel.send('You don\'t have permissions to do that!');
      return;
    }
    else {
      if (message.mentions.channels.first()) {
        targetchannel = message.mentions.channels.first();
      }
      else {
        targetchannel = message.channel;
      }
      if (args[args.length - 1] == '-category') {
        cat = 1;
        targetcategory = guild.channels.cache.get(targetchannel.parentID);
      }
      else {
        cat = 0;
      }
      if (cat == 1 && targetchannel.parent) {
        targetcategory.replacePermissionOverwrites({
          overwrites: [
            {
              id: config[msgguildid].roleUser,
              allow: 7168,
            },
            {
              id: config[msgguildid].roleEveryone,
              deny: 7168,
            },
          ],
        });
        message.channel.send('Reset permissions for category ' + targetcategory.name + '.');
      }
      else {
        if(targetchannel.name == 'welcome') {
          message.channel.send('I cannot modify the welcome channel at this time.');
          return;
        }
        targetchannel.lockPermissions()
          .then(message.channel.send('Syncronized permissions for ' + targetchannel + ' with parent category. This will make the channel public!'))
          .catch(console.error);
      }
    }
  },
};