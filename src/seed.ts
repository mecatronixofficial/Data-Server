/**
 * Seeds the first Super Admin account.
 *
 * Usage:
 *   cd backend
 *   cp .env.example .env   # make sure MONGODB_URI is set
 *   SEED_NAME="Root Admin" SEED_EMAIL="admin@example.com" SEED_PASSWORD="ChangeMe123!" npm run seed
 *
 * If SEED_EMAIL / SEED_PASSWORD are not provided, it falls back to the
 * defaults below — change them immediately after first login either way.
 *
 * Safe to re-run: if a user with that email already exists, it exits
 * without creating a duplicate or touching the existing account.
 */
import * as dotenv from 'dotenv';
import { resolve } from 'path';

const seedEnvironment = process.env.NODE_ENV || 'development';
dotenv.config({
  path: process.env.ENV_FILE || resolve(
    process.cwd(),
    seedEnvironment === 'production' ? '.env.production' : '.env',
  ),
});

import mongoose from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { User, UserSchema } from './users/user.schema';
import { configureMongoSrvDns } from './mongo-dns';

async function connectToMongo() {
  const configuredUri = process.env.MONGODB_URI;

  if (configuredUri) {
    configureMongoSrvDns(configuredUri);
    await mongoose.connect(configuredUri, {
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
    });
    console.log('Connected to the configured MongoDB deployment');
    return { memoryServer: null as MongoMemoryServer | null };
  }

  if (seedEnvironment === 'production') {
    throw new Error('MONGODB_URI is required when seeding production');
  }
  const memoryServer = await MongoMemoryServer.create();
  const uri = await memoryServer.getUri();
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
  });
  console.log(`Connected to local MongoDB at ${uri}`);
  return { memoryServer };
}

async function seed() {
  const name = process.env.SEED_NAME || 'Root Admin';
  const email = (process.env.SEED_EMAIL || 'admin@example.com').toLowerCase();
  const userId = (process.env.SEED_USER_ID || 'SuperAdmin01').trim();
  const password = process.env.SEED_PASSWORD || 'ChangeMe123!';
  let memoryServer: MongoMemoryServer | null = null;

  try {
    if (seedEnvironment === 'production' && (!process.env.SEED_EMAIL || !process.env.SEED_PASSWORD)) {
      throw new Error('SEED_EMAIL and SEED_PASSWORD are required when seeding production');
    }
    if (password.length < 12 || Buffer.byteLength(password, 'utf8') > 72) {
      throw new Error('SEED_PASSWORD must contain at least 12 characters and at most 72 UTF-8 bytes');
    }
    const connection = await connectToMongo();
    memoryServer = connection.memoryServer;

    const UserModel = mongoose.model(User.name, UserSchema);

    const existing = await UserModel.findOne({ email });
    if (existing) {
      console.log(`A user with email "${email}" already exists (role: ${existing.role}). Nothing to do.`);
      return;
    }

    const rounds = Math.min(14, Math.max(10, Number(process.env.BCRYPT_ROUNDS || 12) || 12));
    const hashed = await bcrypt.hash(password, rounds);

    const created = await UserModel.create({
      name,
      email,
      userId,
      userIdKey: userId.toLocaleLowerCase(),
      password: hashed,
      role: 'superadmin',
      createdBy: null,
    });

    console.log('✅ Super Admin created:');
    console.log(`   name:     ${created.name}`);
    console.log(`   email:    ${created.email}`);
    console.log(`   user id:  ${created.userId}`);
    console.log('   password: configured through SEED_PASSWORD (change it after logging in)');
    console.log(`   role:     ${created.role}`);
  } finally {
    await mongoose.disconnect();
    if (memoryServer) {
      await memoryServer.stop();
    }
  }
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
