import 'dotenv/config'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

// this file is responsible for creating a connection to the database using the connection string provided in the environment variable DATABASE_URL
// it uses the drizzle-orm library to create a connection pool and exports the db object that can be used to interact with the database in a type-safe manner
const pool = new Pool({ connectionString: process.env.DATABASE_URL })

export const db = drizzle(pool, { schema })
// this db object is used in every repository functions
// we'll call methods on this db object to perform database operations such as inserting, updating, and querying data in a type-safe manner
// db.insert(chunks)...
// db.select(chunks)...
// db.update(chunks)...