#!/usr/bin/env node
import { hashPassword } from './password.mjs';

const password = process.argv[2];

if (!password) {
  console.error('Usage: node server/hash-password.mjs "<password>"');
  process.exit(1);
}

console.log(hashPassword(password));
