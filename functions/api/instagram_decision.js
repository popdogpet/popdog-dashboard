import { readKV } from '../lib/kv.js';

const EMPTY = {};

export const onRequestGet = ({ env }) => readKV(env, 'ai:instagram_decision', EMPTY, 'instagram_decision');
