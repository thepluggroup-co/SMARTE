import pg from "pg";
import { migrer } from "../src/migrations.js";

const ADMIN = process.env.TEST_ADMIN_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
const BASE = "erp_test";
export const MOT_DE_PASSE_APP = "mot_de_passe_de_test";

export default async function preparation() {
  const client = new pg.Client({ connectionString: ADMIN });
  await client.connect();
  await client.query(`drop database if exists ${BASE} with (force)`);
  await client.query(`create database ${BASE}`);
  await client.end();
  const url = new URL(ADMIN);
  url.pathname = `/${BASE}`;
  await migrer(url.toString(), MOT_DE_PASSE_APP);
  const app = new URL(url);
  app.username = "erp_app";
  app.password = MOT_DE_PASSE_APP;
  process.env.TEST_BASE_ADMIN_URL = url.toString();
  process.env.TEST_BASE_APP_URL = app.toString();
  process.env.NODE_ENV = "test";
}
