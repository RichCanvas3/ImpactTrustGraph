export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import type { D1Database } from '../../../../lib/db';
import { getD1Database } from '../../../../lib/d1-wrapper';

/**
 * GET /api/users/profile?email=... or ?eoa=...
 * POST /api/users/profile - Create or update user profile
 */
// Access database from Cloudflare runtime context or Wrangler CLI
async function getDB(request?: NextRequest): Promise<D1Database | null> {
  // Use the D1 wrapper which handles both native binding and Wrangler CLI fallback
  return await getD1Database();
}

export async function GET(request: NextRequest) {
  try {
    console.log('[users/profile] GET request received');
    const searchParams = request.nextUrl.searchParams;
    const email = searchParams.get('email');
    const eoa = searchParams.get('eoa');

    if (!email && !eoa) {
      return NextResponse.json(
        { error: 'Either email or eoa parameter is required' },
        { status: 400 }
      );
    }

    console.log('[users/profile] Getting database connection...');
    const db = await getDB(request);
    if (!db) {
      console.error('[users/profile] Database not available');
      const useRemote = process.env.USE_REMOTE_D1 === 'true';
      return NextResponse.json(
        { 
          error: 'Database not available',
          message: useRemote 
            ? 'D1 database remote access requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN environment variables. Set USE_REMOTE_D1=true and provide Cloudflare credentials.'
            : 'D1 database binding is not configured. Set USE_REMOTE_D1=true in .env.local with CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN, or use "wrangler pages dev .next" for local development.',
          setupInstructions: {
            remoteAccess: 'Set in .env.local: USE_REMOTE_D1=true, CLOUDFLARE_ACCOUNT_ID=..., CLOUDFLARE_API_TOKEN=...',
            localDev: 'Run: pnpm build && wrangler pages dev .next',
            production: 'Deploy to Cloudflare Pages - DB binding is automatic'
          }
        },
        { status: 500 }
      );
    }

    let profile;
    if (email) {
        console.log('[users/profile] Getting profile by email:', email);
      const result = await db.prepare(
        'SELECT * FROM individuals WHERE email = ?'
      ).bind(email).first();
      profile = result;
    } else if (eoa) {
      const result = await db.prepare(
        'SELECT * FROM individuals WHERE eoa_address = ?'
      ).bind(eoa).first();
      profile = result;
    }

    if (!profile) {
      return NextResponse.json(
        { error: 'Profile not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ profile });
  } catch (error) {
    console.error('[users/profile] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to get user profile',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    console.log('[users/profile] POST request received');
    const body = await request.json();
    console.log('[users/profile] Request body:', { 
      email: body.email, 
      hasEmail: !!body.email,
      hasEoa: !!body.eoa_address,
      hasAa: !!body.aa_address
    });
    const {
      email,
      first_name,
      last_name,
      social_account_id,
      social_account_type,
      eoa_address,
      aa_address,
    } = body;

    if (!email || typeof email !== 'string') {
      console.error('[users/profile] Missing or invalid email');
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      );
    }

    console.log('[users/profile] Getting database connection...');
    const db = await getDB(request);
    if (!db) {
      console.error('[users/profile] Database not available');
      console.error('[users/profile] process.env keys:', typeof process !== 'undefined' ? Object.keys(process.env || {}).filter(k => k.includes('DB') || k.includes('DATABASE')) : 'N/A');
      return NextResponse.json(
        { 
          error: 'Database not available',
          message: 'D1 database binding is not configured. For local development, use "wrangler pages dev .next" instead of "next dev". For production, deploy to Cloudflare Pages where the DB binding is automatically available.',
          setupInstructions: {
            localDev: 'Run: pnpm build && wrangler pages dev .next',
            production: 'Deploy to Cloudflare Pages - DB binding is automatic',
            alternative: 'Set USE_REMOTE_D1=true in .env.local and use Wrangler CLI'
          }
        },
        { status: 500 }
      );
    }
    console.log('[users/profile] Database connection obtained');

    // Check if profile exists
    console.log('[users/profile] Checking if profile exists for:', email);
    const existing = await db.prepare(
      'SELECT id FROM individuals WHERE email = ?'
    ).bind(email).first();

    const now = Math.floor(Date.now() / 1000);
    console.log('[users/profile] Profile exists:', !!existing);

    if (existing) {
      // Update existing profile
      console.log('[users/profile] Updating existing profile');
      const updateResult = await db.prepare(
        `UPDATE individuals 
         SET first_name = ?, last_name = ?, social_account_id = ?, 
             social_account_type = ?, eoa_address = ?, aa_address = ?, 
             updated_at = ?
         WHERE email = ?`
      ).bind(
        first_name || null,
        last_name || null,
        social_account_id || null,
        social_account_type || null,
        eoa_address || null,
        aa_address || null,
        now,
        email
      ).run();
      console.log('[users/profile] Update result:', updateResult);
    } else {
      // Create new profile
      console.log('[users/profile] Creating new profile');
      const insertResult = await db.prepare(
        `INSERT INTO individuals 
         (email, first_name, last_name, social_account_id, social_account_type, 
          eoa_address, aa_address, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        email,
        first_name || null,
        last_name || null,
        social_account_id || null,
        social_account_type || null,
        eoa_address || null,
        aa_address || null,
        now,
        now
      ).run();
      console.log('[users/profile] Insert result:', insertResult);
    }

    // Fetch the updated/created profile
    console.log('[users/profile] Fetching updated profile');
    const profile = await db.prepare(
      'SELECT * FROM individuals WHERE email = ?'
    ).bind(email).first();
    console.log('[users/profile] Profile fetched:', !!profile);

    return NextResponse.json({ profile });
  } catch (error) {
    console.error('[users/profile] Error in POST:', error);
    console.error('[users/profile] Error stack:', error instanceof Error ? error.stack : 'No stack');
    return NextResponse.json(
      {
        error: 'Failed to save user profile',
        message: error instanceof Error ? error.message : 'Unknown error',
        details: process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.stack : undefined) : undefined,
      },
      { status: 500 }
    );
  }
}

