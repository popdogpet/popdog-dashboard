import { readKV } from '../lib/kv.js';

const EMPTY = {
  momentum: 'stable',
  summary: 'Instagram verisi henüz mevcut değil.',
  best_format: null,
  best_topic: null,
  weak_format: null,
  strongest_post: null,
  fatigue_risk: null,
  updated_at: null,
};

export const onRequestGet = ({ env }) => readKV(env, 'ai:instagram_live_summary', EMPTY, 'instagram_live_summary');
