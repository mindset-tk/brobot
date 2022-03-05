const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
const { discordAuthToken } = require('../apitokens.json');
const fs = require('node:fs');
const path = require('path');
const slashPath = path.resolve('./slashcommands');

async function registerSlashes() {
  const commands = [];
  const commandFiles = fs.readdirSync(slashPath).filter(file => file.endsWith('.js'));

  // registers commands with guild at startup.
  // Place your client and guild ids here (testing only. TODO setup global registration)
  const clientId = '943720697291743262';
  const guildId = '826589443762290698';

  for (const file of commandFiles) {
    const command = require(`${slashPath}/${file}`);
    commands.push(command.data.toJSON());
  }

  const rest = new REST({ version: '9' }).setToken(discordAuthToken);

  (async () => {
    try {
      console.log('Started refreshing application (/) commands.');

      await rest.put(
        Routes.applicationGuildCommands(clientId, guildId),
        { body: commands },
      );

      console.log('Successfully reloaded application (/) commands.');
    }
    catch (error) {
      console.error(error);
    }
  })();
}

module.exports = {
  init: registerSlashes,
};
