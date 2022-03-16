/* const { SlashCommandBuilder } = require('@discordjs/builders');
// currently does nothing.
module.exports = {
  data: new SlashCommandBuilder()
    .setName('event')
    .setDescription('Create or manage events')
    .addSubcommand(subcommand =>
      subcommand
        .setName('create')
        .setDescription('create an event'))
    .addSubcommand(subcommand =>
      subcommand
        .setName('edit')
        .setDescription('edit an event'))
    .addSubcommand(subcommand =>
      subcommand
        .setName('cancel')
        .setDescription('cancel an event')),
  async execute(interaction) {
    await interaction.reply('Pong!');
  },
}; */
