/**
 * Prepara la base de datos desde cero: aplica las migraciones en orden y carga el
 * dataset oficial de 50 medicamentos.
 *
 *     npm run db:setup
 *
 * Idempotente: todas las migraciones usan `if not exists` / `on conflict do nothing`,
 * así que se puede correr sobre una base ya inicializada sin romper nada.
 *
 * Usa DIRECT_URL (conexión directa, puerto 5432) y no el pooler: el DDL y las
 * extensiones necesitan una sesión propia.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('Falta DIRECT_URL (o DATABASE_URL). Corré `vercel env pull .env.local` primero.');
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

const migrationsDir = join(process.cwd(), 'db', 'migrations');
const seedFile = join(process.cwd(), 'db', 'seed', 'seed.sql');

try {
  const migrations = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  for (const file of migrations) {
    process.stdout.write(`  migración ${file} … `);
    await sql.unsafe(readFileSync(join(migrationsDir, file), 'utf8'));
    console.log('ok');
  }

  process.stdout.write('  seed de medicamentos … ');
  await sql.unsafe(readFileSync(seedFile, 'utf8'));
  console.log('ok');

  // La proyección del catálogo se construye a partir del write model recién cargado.
  process.stdout.write('  proyección del catálogo … ');
  await sql.unsafe(`
    insert into public.medication_catalog_projection
      (medication_id, sku, name, active_ingredient, active_ingredient_id, category, category_id,
       category_slug, laboratory, laboratory_id, dosage, presentation, price, stock, in_stock,
       requires_prescription, description, projected_at)
    select m.id, m.sku, m.name, ai.name, ai.id, c.name, c.id, c.slug, l.name, l.id,
           m.dosage, m.presentation, m.price, m.stock, m.stock > 0,
           m.requires_prescription, m.description, now()
    from public.medications m
    join public.active_ingredients ai on ai.id = m.active_ingredient_id
    join public.categories         c  on c.id  = m.category_id
    join public.laboratories       l  on l.id  = m.laboratory_id
    on conflict (medication_id) do update set
      price = excluded.price, stock = excluded.stock,
      in_stock = excluded.in_stock, projected_at = now();
  `);
  console.log('ok');

  const [counts] = await sql`
    select (select count(*) from public.medications) as medicamentos,
           (select count(*) from public.medication_catalog_projection) as proyeccion
  `;
  console.log(`\nListo: ${counts.medicamentos} medicamentos, ${counts.proyeccion} en la proyección.`);
} finally {
  await sql.end();
}
