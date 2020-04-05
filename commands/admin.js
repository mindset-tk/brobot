const path = require('path');
const configPath = path.resolve('./config.json');
const config = require(configPath);


module.exports = {
  name: 'admin',
  description: 'Toggle admin status on sender. Only works if sender has the Bros role.',
  guildOnly: true,
  execute(message, args, client) {
    const announcements = client.channels.cache.get(config.channelAnnouncements);
    if (message.member.roles.cache.has(config.roleBros) && !message.member.roles.cache.has(config.roleAdmin)) {
      message.channel.send('Elevating you to Admin');
      announcements.send('@everyone : ' + message.author + ' has escalated to admin!');
      message.member.addRole(config.roleAdmin);
    }
    else if (message.member.roles.cache.has(config.roleBros) && message.member.roles.cache.has(config.roleAdmin)) {
      message.channel.send('De-elevating you from Admin');
      announcements.send('@everyone : ' + message.author + ' has de-escalated from admin!');
      message.member.removeRole(config.roleAdmin);
    }
    else {
      message.channel.send ('You do not have rights to do that!');
    }
  },
};