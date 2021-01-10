'use strict';

const Action = require('./Action');
const { Events } = require('../../util/Constants');

class MessageCreateAction extends Action {
  handle(data) {
    const client = this.client;
    const channel = client.channels.cache.get(data.channel_id);
    if (channel) {
      const existing = channel.messages.cache.get(data.id);
      if (existing) return { message: existing };
      const message = channel.messages.add(data);

      /**
       * Emitted whenever a message is created.
       * @event Client#message
       * @param {Message} message The created message
       */
      client.emit(Events.MESSAGE_CREATE, message);
      return { message };
    }

    return {};
  }
}

module.exports = MessageCreateAction;
