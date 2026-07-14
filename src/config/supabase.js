/* =========================================================
   Cliente Supabase (fonte oficial dos dados)
   ========================================================= */
const { createClient } = require('@supabase/supabase-js');

console.log('SUPABASE URL EXISTE:', !!process.env.SUPABASE_URL);
console.log('SUPABASE KEY EXISTE:', !!process.env.SUPABASE_KEY);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

module.exports = supabase;
