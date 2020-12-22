'use strict';

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const Shard = require('./Shard');
const { Error } = require('../errors');
const Collection = require('../util/Collection');
const Util = require('../util/Util');

/**
 * This is a utility class that makes multi-process sharding of a bot an easy and painless experience.
 * It works by spawning a self-contained {@link ChildProcess} or {@link Worker} for each individual shard, each
 * containing its own instance of your bot's {@link Client}. They all have a line of communication with the master
 * process, and there are several useful methods that utilise it in order to simplify tasks that are normally difficult
 * with sharding. It can spawn a specific number of shards or the amount that Discord suggests for the bot, and takes a
 * path to your main bot script to launch for each one.
 * @extends {EventEmitter}
 */
class ShardingManager extends EventEmitter {
  /**
   * @param {string} file Path to your shard script file
   * @param {number} amount Shards count for the sharding manager
   * @param {number} token Shards count for the sharding manager
   */
  constructor(file, amount, token) {
    super();

    /**
     * Path to the shard script file
     * @type {string}
     */
    this.file = file;
    if (!file) throw new Error('CLIENT_INVALID_OPTION', 'File', 'specified.');
    if (!path.isAbsolute(file)) this.file = path.resolve(process.cwd(), file);
    const stats = fs.statSync(this.file);
    if (!stats.isFile()) throw new Error('CLIENT_INVALID_OPTION', 'File', 'a file');

    /**
     * List of shards this sharding manager spawns
     * @type {string|number[]}
     */
    this.shardList = [...Array(amount).keys()];

    /**
     * Amount of shards that all sharding managers spawn in total
     * @type {number}
     */
    this.totalShards = amount;

    /**
     * A collection of shards that this manager has spawned
     * @type {Collection<number, Shard>}
     */
    this.shards = new Collection();

    /**
     * Token of the bot
     * @type {string}
     */
    this.token = token;

    process.env.SHARDING_MANAGER = true;
  }

  /**
   * Creates a single shard.
   * <warn>Using this method is usually not necessary if you use the spawn method.</warn>
   * @param {number} shardID ID of the shard to create
   * @returns {Shard} Note that the created shard needs to be explicitly spawned using its spawn method.
   */
  createShard(shardID) {
    const shard = new Shard(this, shardID);
    this.shards.set(shardID, shard);
    return shard;
  }

  /**
   * Spawns multiple shards.
   * @param {number} [delay=5500] How long to wait in between spawning each shard (in milliseconds)
   * @param {number} [spawnTimeout=30000] The amount in milliseconds to wait until the {@link Client} has become ready
   * before resolving. (-1 or Infinity for no wait)
   * @returns {Promise<Collection<number, Shard>>}
   */
  async spawn(delay = 5500, spawnTimeout) {
    // Spawn the shards
    for (const shardID of this.shardList) {
      const promises = [];
      const shard = this.createShard(shardID);
      promises.push(shard.spawn(spawnTimeout));
      if (delay > 0 && this.shards.size !== this.shardList.length) promises.push(Util.delayFor(delay));
      await Promise.all(promises); // eslint-disable-line no-await-in-loop
    }

    return this.shards;
  }

  /**
   * Sends a message to all shards.
   * @param {*} message Message to be sent to the shards
   * @returns {Promise<Shard[]>}
   */
  async broadcast(message) {
    const promises = [];
    for (const shard of this.shards.values()) promises.push(shard.send(message));
    const responses = await Promise.allSettled(promises);
    return responses.filter(r => r.status === 'fulfilled').map(res => res.value);
  }

  /**
   * Evaluates a script on all shards, in the context of the {@link Client}s.
   * @param {string} script JavaScript to run on each shard
   * @returns {Promise<Array<*>>} Results of the script execution
   */
  async broadcastEval(script) {
    const promises = [];
    for (const shard of this.shards.values()) promises.push(shard.eval(script));
    const responses = await Promise.allSettled(promises);
    return responses.filter(r => r.status === 'fulfilled').map(res => res.value);
  }

  /**
   * Fetches a client property value of each shard.
   * @param {string} prop Name of the client property to get, using periods for nesting
   * @returns {Promise<Array<*>>}
   * @example
   * manager.fetchClientValues('guilds.cache.size')
   *   .then(results => console.log(`${results.reduce((prev, val) => prev + val, 0)} total guilds`))
   *   .catch(console.error);
   */
  async fetchClientValues(prop) {
    if (this.shards.size === 0) return Promise.reject(new Error('SHARDING_NO_SHARDS'));
    if (this.shards.size !== this.shardList.length) return Promise.reject(new Error('SHARDING_IN_PROCESS'));
    const promises = [];
    for (const shard of this.shards.values()) promises.push(shard.fetchClientValue(prop));
    const responses = await Promise.allSettled(promises);
    return responses.filter(r => r.status === 'fulfilled').map(res => res.value);
  }

  /**
   * Kills all running shards and respawns them.
   * @param {number} [shardDelay=5000] How long to wait between shards (in milliseconds)
   * @param {number} [respawnDelay=500] How long to wait between killing a shard's process and restarting it
   * (in milliseconds)
   * @param {number} [spawnTimeout=30000] The amount in milliseconds to wait for a shard to become ready before
   * continuing to another. (-1 or Infinity for no wait)
   * @returns {Promise<Collection<string, Shard>>}
   */
  async respawnAll(shardDelay = 5000, respawnDelay = 500, spawnTimeout) {
    let s = 0;
    for (const shard of this.shards.values()) {
      const promises = [shard.respawn(respawnDelay, spawnTimeout)];
      if (++s < this.shards.size && shardDelay > 0) promises.push(Util.delayFor(shardDelay));
      await Promise.all(promises); // eslint-disable-line no-await-in-loop
    }
    return this.shards;
  }
}

module.exports = ShardingManager;
