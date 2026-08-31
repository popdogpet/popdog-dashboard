import { readKV } from '../lib/kv.js';

const EMPTY = {
  slots: [],
  updated_at: null,
};

export const onRequestGet = ({ env }) => readKV(env, 'ai:instagram_calendar_suggestions', EMPTY, 'instagram_calendar_suggestions');
