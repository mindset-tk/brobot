module.exports = {
  name: 'hello',
  aliases: ['ping', 'beep'],
  description() { return 'Pings bot to verify operation';},
  cooldown: 3,
  execute(message) {
    if (message.channel.type == 'GUILD_TEXT') {
      const botguildmember = message.guild.me;
      message.channel.send('Hello, I am ' + botguildmember.displayName + '.');
    }
    else {
      message.channel.send(`Hello, I am ${message.client.user}`);
    }
  },
};