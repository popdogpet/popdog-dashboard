import { readKV } from '../lib/kv.js';

const EMPTY = {
  items: [],
  updated_at: null,
};

export const onRequestGet = ({ env }) => readKV(env, 'ai:instagram_recommendations', EMPTY, 'instagram_recommendations');
