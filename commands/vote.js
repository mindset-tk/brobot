// TODO: test multi-server
// TODO: convert to SQL
const Discord = require('discord.js');
const moment = require('moment-timezone');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const voteDataPath = path.resolve('./votes.json');
const { promptForMessage, promptYesNo, getConfig, isTextChannel } = require('../extras/common.js');

async function writeVoteState() {
  return fsp.writeFile(
    voteDataPath,
    JSON.stringify(global.voteData, null, 2),
  );
}

const DEFAULT_VOTE_DATA = {
  votes: {},
};

if (global.voteData == null) {
  if (!fs.existsSync(voteDataPath)) {
    fs.writeFileSync(voteDataPath, JSON.stringify(DEFAULT_VOTE_DATA));
  }
  global.voteData = require(voteDataPath);
}

class VoteManager {
  /**
   * Create a new voteManager instance.
   *
   * @param client Discord client instance
   */
  constructor(client) {
    this.client = client;
    this.timer = null;
    this.ongoingVotes = {};
  }

  /**
   * Load the state of the voteManager from the global JSON data.
   */
  async loadState() {
    if (global.voteData.votes) {
      // Convert saved date strings back into Moment datetime objects
      // and saved vote lists from an array of pairs back to an ES6 map.
      Object.entries(global.voteData.votes).forEach(([guild, votes]) => {
        this.ongoingVotes[guild] = votes.map((vote) => ({
          ...vote,
          due: moment.utc(vote.due, moment.ISO_8601, true),
          votes: new Map(vote.votes),
        }));
      });
    }
  }

  /**
   * Save the state of the voteManager to the global JSON data.
   *
   * @returns {Promise<*>} Resolves when the data file has been written out.
   */
  async saveState() {
    // Serialize moment datetimes as ISO8601 strings
    // convert votes map to json with spread
    Object.entries(this.ongoingVotes).forEach(([guild, votes]) => {
      if (votes.length !== undefined) {
        global.voteData.votes[guild] = votes.map((vote) => ({
          ...vote,
          due: vote.due.toISOString(),
          votes: [...vote.votes || ''],
        }));
      }
    });

    return writeVoteState();
  }

  /**
   * Start running the timer for recurring voteManager tasks.
   */
  start() {
    // Tick immediately at start to do cleanup
    this.tick().then(() => {
      // Ensure we're always at (or close to) the 'top' of a minute when we run our tick
      const topOfMinute = 60000 - (Date.now() % 60000);
      this.timer = setTimeout(() => {
        this.timer = setInterval(() => this.tick(), 60000);
        this.tick();
      }, topOfMinute);
    });
  }

  /**
   * Perform a single run of the checks for pending scheduled tasks.
   *
   * @returns {Promise<void>} Resolves when the work for this tick is finished.
   */
  async tick() {
    const now = moment.utc();
    const votesByGuild = Object.entries(this.ongoingVotes);

    for (const [guild, votes] of votesByGuild) {
      const endingVotes = votes.filter((vote) => vote.due.isSameOrBefore(now));
      this.ongoingVotes[guild] = votes.filter((vote) =>
        vote.due.isAfter(now),
      );
      await this.saveState();

      if (endingVotes.length > 0) {
        for (const vote of endingVotes) {
          /* const voteAge = moment.duration(now.diff(vote.due));
          // Discard votes we missed for more than 5 minutes
          if (voteAge.asMinutes() >= 5) {
            break;
          } */
          const destChannel = await this.client.channels.fetch(vote.channel);
          if (!destChannel) {
            console.log('Got vote for unknown channel', vote.channel);
            break;
          }
          // console.log(vote);
          const totals = this.getResults(vote);
          let resultString = '';
          totals.forEach((v, k) => resultString += `${k} : ${v}\n`);
          // send vote results to channel
          await destChannel.send(`In the matter of '${vote.summary}', the vote results are: \n ${resultString}`);
          const voteMsg = await destChannel.messages.fetch(vote.message);
          voteMsg.reactions.removeAll();
        }
      }
    }
    await this.saveState();

  }

  /**
   * Stop running the voteManager timer.
   */
  stop() {
    this.client.clearTimeout(this.timer);
    this.client.clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Add a new vote to the voteManager.
   *
   * @param vote The data for the vote.
   * @returns {Promise<*>} Resolves once the vote has been saved persistently.
   */
  async add(vote) {
    const guild = vote.guild;
    if (!this.ongoingVotes[guild]) {
      this.ongoingVotes[guild] = [];
    }
    this.ongoingVotes[guild].push(vote);
    this.ongoingVotes[guild].sort((a, b) => a.due.diff(b.due));
    return this.saveState();
  }

  /**
   * Update votes on an object
   *
   * @param guildId Snowflake of the Guild to scope votes to.
   * @param userId Snowflake of the User whose vote will be tallied.
   * @param msgId MessageId of the vote to be updated.
   * @param emoji Emoji of the vote to be tallied; note that 🚫 will always be added to votes; this allows users to remove accidental votes.
   * @returns {boolean} Whether the user was tallied to the vote (false if already voted for the same emoji).
   */
  async updateVotes(guildId, userId, msgId, emoji) {
    const user = await this.client.users.fetch(userId);
    const vote = this.getByMsg(guildId, msgId);
    if (!vote) {
      return false;
    }
    if (emoji == '🚫' && vote.votes.has(userId)) {
      vote.votes.delete(userId);
      user.send('Your vote was removed from the following vote: \'' + vote.summary + '\'');
    }
    else if (emoji == '🚫' && !vote.votes.has(userId)) {
      user.send('You have no vote on record for \'' + vote.summary + '\'. No action was taken.');
    }
    else if (vote.emoji.includes(emoji)) {
      const DMreply = vote.votes.has(userId) ? `Your vote was changed to ${emoji}` : `You successfully voted ${emoji}`;
      vote.votes.set(userId, emoji);
      try {
        await user.send(DMreply + ` for '${vote.summary}'.`);
      }
      catch {
        console.log('Could not send a DM for vote reciept.');
      }
    }

    return true;
  }

  _indexByMsg(guildId, msgId) {
    if (!this.ongoingVotes[guildId]) {
      return undefined;
    }
    const index = this.ongoingVotes[guildId].findIndex(
      (vote) => vote.message == msgId,
    );
    return index !== -1 ? index : undefined;
  }

  /**
 * Get the vote with this messageId on a specific guild.
 *
 * @param guildId The Snowflake corresponding to the vote's guild
 * @param msgId The snowflake of the vote message
 * @returns Vote data or undefined
 */
  getByMsg(guildId, msgId) {
    const index = this._indexByMsg(guildId, msgId);
    return index !== undefined ? this.ongoingVotes[guildId][index] : index;
  }

  /**
 * Collate results of vote.
 *
 * @param vote The voteData object for a particular vote
 * @returns ES6 map of totals for each vote option.
 */
  getResults(vote) {
    const voteCounts = new Map();
    // initialize VoteCounts at 0 for every emoji in the list.
    const filteredEmoji = vote.emoji.filter(e => {return e !== '🚫';});
    filteredEmoji.forEach(voteEmoji => { voteCounts.set(voteEmoji, 0);});
    if (vote.votes && vote.votes.size > 0) {
      for (const voteEntry of vote.votes.values()) {
        voteCounts.set(voteEntry, voteCounts.get(voteEntry) + 1);
      }
    }
    return voteCounts;
  }

}

let voteManager;

function getActiveVoteMessages(guildId) {
  // search through vote.json and find the message Id on each active vote.
  // then return a list of all messages as an arr.
  const messageArr = [];
  if (global.voteData.votes[guildId]) {
    global.voteData.votes[guildId].forEach(vote => {
      messageArr.push(vote.message);
    });
  }
  return messageArr;
}

module.exports = {
  name: 'vote',
  description() { return 'generates a message that can be voted on with reactions.';},
  usage() { return '';},
  aliases: 'poll',
  cooldown: 3,
  guildOnly: true,
  staffOnly: false,
  args: false,
  async execute(message) {
    const config = getConfig(message.client, message.guild.id);
    const dmChannel = await message.author.createDM();
    const voteData = {};
    await dmChannel.send('You can type cancel to cancel this wizard at any time.\nWhat would you like the text of your vote to be?');
    let result = await promptForMessage(dmChannel, async (reply) => {
      const content = reply.content.trim();
      if (content.toLowerCase() === 'cancel') {
        dmChannel.send(
          `Vote creation cancelled. Please run ${config.prefix}vote again to initiate event creation again.`,
        );
        return 'abort';
      }
      else { return voteData.summary = content; }
    });
    if (!result) {return;}
    await dmChannel.send('Please list the emoji you wish to use for this vote, separated by only a space. (eg. "👍 👎").\nDue to limitations of Discord, you may only use standard emoji, and 🚫 will always be included as a vote remover option.');
    result = await promptForMessage(dmChannel, async (reply) => {
      let content = reply.content.trim();
      content = content.replace(/ +/g, ' ');
      if (content.toLowerCase() === 'cancel') {
        dmChannel.send(
          `Vote creation cancelled. Please run ${config.prefix}vote again to initiate event creation again.`,
        );
        return 'abort';
      }
      else {
        voteData.emoji = content.split(' ');
        return voteData.emoji.push('🚫');
      }
    });
    if (!result) {return;}
    let humanReadableDuration;
    await dmChannel.send('How long shall the vote run for?\nPlease answer in the form of "10 minutes", "5 hours", "1 day", "3 weeks"');
    result = await promptForMessage(dmChannel, async (reply) => {
      let content = reply.content.trim();
      content = content.replace(/ +/g, ' ');
      if (content.toLowerCase() === 'cancel') {
        dmChannel.send(
          `Vote creation cancelled. Please run ${config.prefix}vote again to initiate event creation again.`,
        );
        return 'abort';
      }
      else {
        humanReadableDuration = content;
        const durationData = content.split(' ');
        try { return voteData.due = moment().add(durationData[0], durationData[1]); }
        catch {
          dmChannel.send('Sorry, I couldn\'t parse that. Please answer in the form of "10 minutes", "5 hours", "1 day", "3 weeks", etc.');
          return 'retry';
        }
      }
    });
    if (!result) {return;}
    await dmChannel.send(`Does this look OK?\nVote text: ${voteData.summary}\n Duration: ${humanReadableDuration}\n Emoji: ${voteData.emoji}`);
    result = await promptYesNo(dmChannel, {
      messages: {
        yes: 'OK, your vote is now posted.',
        no: 'OK, please run the command again to post a vote (looping not yet implemented).',
        cancel:
          'Vote creation cancelled!',
        invalid: 'Reply not recognized! Please answer Y or N.',
      },
    });
    if (!result || !result.answer) {return false;}
    voteData.channel = message.channel.id;
    voteData.creator = message.author.id;
    voteData.guild = message.guild.id;
    // create a vote embed and send to the channel.
    const voteMsg = await message.channel.send(`Please vote with the reaction buttons on the following: \n ${voteData.summary} \n If you would like to remove a vote you already made, please use the 🚫 react.`);
    voteData.message = voteMsg.id;
    voteData.emoji.forEach(async e => await voteMsg.react(e));
    voteData.votes = new Map();
    voteManager.add(voteData);
  },
  async init(client) {
    const onReady = () => {
      voteManager = new VoteManager(client);
      voteManager.loadState().then(() => {
        voteManager.start();
        console.log('Vote manager ready.');
      });
    };
    if (client.status !== Discord.Constants.Status.READY) {
      client.on('ready', onReady);
    }
    else {
      onReady();
    }
    client.on('messageReactionAdd', async (reaction, user) => {
      // return if the event isn't a reaction add, or if it was a bot reaction.
      if (user.bot) { return; }
      if (reaction.partial) {
        // If the message this reaction belongs to was removed, the fetching might result in an API error which should be handled
        try {
          await reaction.fetch();
        }
        catch (error) {
          console.error('Something went wrong when fetching the message:', error);
          // Return as `reaction.message.author` may be undefined/null
          return;
        }
      }
      // then check if the message in question is one of the vote-related messages.
      if (!isTextChannel(reaction.message.channel)) { return; }
      else if (!getActiveVoteMessages(reaction.message.guild.id).includes(reaction.message.id)) {
        return;
      }
      const channel = client.channels.cache.get(reaction.message.channel.id);
      const message = await channel.messages.fetch(reaction.message.id);
      reaction.emoji.id ? await message.reactions.resolve(reaction.emoji.id).users.remove(user.id) : await message.reactions.resolve(reaction.emoji.name).users.remove(user.id);
      voteManager.updateVotes(message.guild.id, user.id, message.id, reaction.emoji.name);
    });
  },
};