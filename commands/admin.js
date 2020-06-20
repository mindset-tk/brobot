const path = require('path');
const configPath = path.resolve('./config.json');
const config = require(configPath);


module.exports = {
  name: 'admin',
  description: 'Toggle admin status on sender. Only works if sender has the Bros role.',
  guildOnly: true,
  guildLimit: ['598939818600300550'],
  execute(message, args, client, msgguildid) {
    const announcements = client.channels.cache.get(config[msgguildid].channelAnnouncements);
    if (message.member.roles.cache.has(config[msgguildid].roleUser) && !message.member.roles.cache.has(config[msgguildid].roleAdmin)) {
      message.channel.send('Elevating you to Admin');
      announcements.send('@everyone : ' + message.author + ' has escalated to admin!');
      message.member.addRole(config[msgguildid].roleAdmin);
    }
    else if (message.member.roles.cache.has(config[msgguildid].roleUser) && message.member.roles.cache.has(config[msgguildid].roleAdmin)) {
      message.channel.send('De-elevating you from Admin');
      announcements.send('@everyone : ' + message.author + ' has de-escalated from admin!');
      message.member.removeRole(config[msgguildid].roleAdmin);
    }
    else {
      message.channel.send ('You do not have rights to do that!');
    }
  },
};