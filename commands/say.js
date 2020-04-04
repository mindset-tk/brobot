module.exports = {
  name: 'say',
  description: 'Make the bot talk. Will speak in the same channel as the command is used unless one is #mentioned as the first argument.',
  usage: '[channel #mention (optional)] [what to say]',
  cooldown: 3,
  guildOnly: true,
  args: true,
  execute(message, args) {
    let targetChannel = message.channel;
    const channelMatch = args[0].match(/^<#(\d+)>$/);
    if (channelMatch) {
      targetChannel = message.guild.channels.cache.get(channelMatch[1]);
      args.shift();
    }
    const sayMessage = args.join(' ');
    message.delete();
    targetChannel.send(sayMessage);
  },
};