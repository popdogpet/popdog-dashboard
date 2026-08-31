import { readKV } from '../lib/kv.js';

const EMPTY = { title: '', why: '', impact: '', next_steps: [], updated_at: null };

export const onRequestGet = ({ env }) => readKV(env, 'ai:focus', EMPTY, 'focus');
