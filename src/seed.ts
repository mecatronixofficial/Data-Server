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
dotenv.config();

import mongoose from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { User, UserSchema } from './users/user.schema';
import { configureMongoSrvDns } from './mongo-dns';

async function connectToMongo() {
  const configuredUri = process.env.MONGODB_URI;

  if (configuredUri) {
    try {
      configureMongoSrvDns(configuredUri);
      await mongoose.connect(configuredUri, {
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
      });
      console.log(`Connected to ${configuredUri}`);
      return { uri: configuredUri, memoryServer: null as MongoMemoryServer | null };
    } catch (error) {
      console.warn(`Configured MongoDB URI is unavailable. Falling back to local MongoDB. ${error}`);
    }
  }

  const memoryServer = await MongoMemoryServer.create();
  const uri = await memoryServer.getUri();
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
  });
  console.log(`Connected to local MongoDB at ${uri}`);
  return { uri, memoryServer };
}

async function seed() {
  const name = process.env.SEED_NAME || 'Root Admin';
  const email = (process.env.SEED_EMAIL || 'admin@example.com').toLowerCase();
  const password = process.env.SEED_PASSWORD || 'ChangeMe123!';
  let memoryServer: MongoMemoryServer | null = null;

  try {
    const connection = await connectToMongo();
    memoryServer = connection.memoryServer;

    const UserModel = mongoose.model(User.name, UserSchema);

    const existing = await UserModel.findOne({ email });
    if (existing) {
      console.log(`A user with email "${email}" already exists (role: ${existing.role}). Nothing to do.`);
      return;
    }

    const hashed = await bcrypt.hash(password, 10);

    const created = await UserModel.create({
      name,
      email,
      password: hashed,
      role: 'superadmin',
      createdBy: null,
    });

    console.log('✅ Super Admin created:');
    console.log(`   name:     ${created.name}`);
    console.log(`   email:    ${created.email}`);
    console.log(`   password: ${password}  (change this after logging in)`);
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
