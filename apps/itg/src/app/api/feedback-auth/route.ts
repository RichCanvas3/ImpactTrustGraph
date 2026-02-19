export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import {
  createMiddlewareHeaders,
  extractAgentNameFromEns,
} from '../../../lib/url-utils';
import http from 'http';

/**
 * GET /api/feedback-auth?clientAddress=...&agentName=...&agentId=...&chainId=...
 * Request feedbackAuth from A2A agent endpoint
 */
export async function GET(request: NextRequest) {
  console.log('\n\n\n');
  console.log('[feedback-auth] ========================================');
  console.log('[feedback-auth] GET /api/feedback-auth CALLED');
  console.log('[feedback-auth] Timestamp:', new Date().toISOString());
  console.log('[feedback-auth] URL:', request.url);
  console.log('[feedback-auth] ========================================');
  console.log('\n\n\n');
  try {
    const searchParams = request.nextUrl.searchParams;
    const clientAddress = searchParams.get('clientAddress');
    const agentName = searchParams.get('agentName');
    const agentId = searchParams.get('agentId');
    const chainId = searchParams.get('chainId');
    
    console.log('[feedback-auth] Query parameters:', {
      clientAddress,
      agentName,
      agentId,
      chainId,
    });

    if (!clientAddress) {
      return NextResponse.json(
        { error: 'Missing clientAddress parameter' },
        { status: 400 }
      );
    }

    if (!agentName && (!agentId || !chainId)) {
      return NextResponse.json(
        { error: 'Either agentName or both agentId and chainId are required' },
        { status: 400 }
      );
    }

    // Get agent A2A endpoint
    let a2aEndpoint: string | null = null;

    if (agentName) {
      // Try to get agent info by name to find A2A endpoint
      try {
        const agentResponse = await fetch(
          `${request.nextUrl.origin}/api/agents/search`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: agentName, page: 1, pageSize: 1 }),
          }
        );

        if (agentResponse.ok) {
          const agentData = await agentResponse.json();
          const agent = agentData.agents?.[0];
          if (agent?.a2aEndpoint) {
            a2aEndpoint = agent.a2aEndpoint;
          } else if (agent?.agentUrl) {
            const baseUrl = agent.agentUrl.replace(/\/$/, '');
            a2aEndpoint = `${baseUrl}/api/a2a`;
          }
        }
      } catch (err) {
        console.warn('[feedback-auth] Failed to resolve agent by name:', err);
      }
    }

    // If we have agentId and chainId, try to get agent info
    if (!a2aEndpoint && agentId && chainId) {
      try {
        const { buildDid8004 } = await import('@agentic-trust/core');
        const did = buildDid8004(Number(chainId), Number(agentId));
        const agentResponse = await fetch(
          `${request.nextUrl.origin}/api/agents/${encodeURIComponent(did)}`
        );

        if (agentResponse.ok) {
          const agentData = await agentResponse.json();
          if (agentData.a2aEndpoint) {
            a2aEndpoint = agentData.a2aEndpoint;
          } else if (agentData.agentUrl) {
            const baseUrl = agentData.agentUrl.replace(/\/$/, '');
            a2aEndpoint = `${baseUrl}/api/a2a`;
          }
        }
      } catch (err) {
        console.warn('[feedback-auth] Failed to resolve agent by DID:', err);
      }
    }

    if (!a2aEndpoint) {
      return NextResponse.json(
        { error: 'Could not determine A2A endpoint for agent' },
        { status: 400 }
      );
    }

    // Ensure A2A endpoint is correct format
    if (a2aEndpoint.includes('/.well-known/agent-card.json')) {
      a2aEndpoint = a2aEndpoint.replace('/.well-known/agent-card.json', '/api/a2a');
    } else if (!a2aEndpoint.endsWith('/api/a2a')) {
      const baseUrl = a2aEndpoint.replace(/\/api\/a2a$/, '').replace(/\/$/, '');
      a2aEndpoint = `${baseUrl}/api/a2a`;
    }

    // Normalize URL protocol if missing
    if (!a2aEndpoint.startsWith('http://') && !a2aEndpoint.startsWith('https://')) {
      a2aEndpoint = `https://${a2aEndpoint}`;
    }

    // Parse the URL to extract hostname, port, and path
    // We need to preserve the original hostname (e.g., gmail-itg.localhost:3000)
    // for routing, but use localhost:PORT for the actual connection
    const urlObj = new URL(a2aEndpoint);
    const originalHost = urlObj.host; // e.g., "gmail-itg.localhost:3000"
    const port = urlObj.port || (urlObj.protocol === 'https:' ? '443' : '80');
    const path = urlObj.pathname + urlObj.search;
    
    // For subdomain localhost, use localhost:PORT for the connection
    // but preserve original host in Host header for routing
    let fetchUrl = a2aEndpoint;
    if (urlObj.hostname.includes('.localhost')) {
      fetchUrl = `http://localhost:${port}${path}`;
      console.log('[feedback-auth] Using localhost for connection, preserving original host in headers:', {
        original: a2aEndpoint,
        fetchUrl: fetchUrl,
        originalHost: originalHost,
      });
    }

    console.log('\n\n\n');
    console.log('[feedback-auth] ========================================');
    console.log('[feedback-auth] Making A2A request for feedback auth');
    console.log('[feedback-auth] ========================================');
    console.log('[feedback-auth] A2A Endpoint:', a2aEndpoint);
    console.log('[feedback-auth] Fetch URL:', fetchUrl);
    console.log('[feedback-auth] Original Host (for routing):', originalHost);
    console.log('[feedback-auth] This should hit impact-agent server on port 3000');
    console.log('[feedback-auth] ========================================');
    console.log('\n\n\n');
    console.log('[feedback-auth] Request params:', {
      clientAddress,
      agentName,
      agentId,
      chainId,
    });

    // Use the original A2A endpoint URL directly
    // Extract agent name from agentName parameter if available
    const finalAgentName = agentName ? extractAgentNameFromEns(agentName) : null;
    const finalEnsName = agentName || null;

    const requestHeaders = createMiddlewareHeaders(
      finalAgentName,
      finalEnsName,
      null
    );

    // Set the Host header to the original hostname for routing
    // This allows the middleware to extract the agent name from the hostname
    if (urlObj.hostname.includes('.localhost')) {
      (requestHeaders as any)['Host'] = originalHost;
      console.log('[feedback-auth] Set Host header to original hostname for routing:', originalHost);
    }

    console.log('[feedback-auth] Request headers:', Object.fromEntries(Object.entries(requestHeaders)));

    const requestBody = {
      skillId: 'agent.feedback.requestAuth',
      payload: {
        clientAddress,
        ...(agentName ? { agentName } : {}),
        ...(agentId ? { agentId } : {}),
        ...(chainId ? { chainId: Number(chainId) } : {}),
      },
    };
    console.log('[feedback-auth] Request body:', JSON.stringify(requestBody, null, 2));

    // Use native http module to set Host header correctly for routing
    // Node.js fetch may ignore/override the Host header, so we use http.request
    // to ensure the Host header is set to gmail-itg.localhost:3000 for routing
    let feedbackAuthResponse: Response;
    
    if (urlObj.hostname.includes('.localhost')) {
      // Use http module to preserve Host header for routing
      const bodyString = JSON.stringify(requestBody);
      
      // Convert Headers object to plain object for http.request
      const plainHeaders: Record<string, string> = {};
      if (requestHeaders instanceof Headers) {
        requestHeaders.forEach((value, key) => {
          plainHeaders[key] = value;
        });
      } else {
        Object.assign(plainHeaders, requestHeaders);
      }
      
      const response = await new Promise<Response>((resolve, reject) => {
        const options = {
          hostname: 'localhost',
          port: parseInt(port, 10),
          path: path,
          method: 'POST',
          headers: {
            ...plainHeaders,
            'Host': originalHost, // Set Host header to gmail-itg.localhost:3000 for routing
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(bodyString),
          },
        };

        console.log('[feedback-auth] Making http.request with Host header:', originalHost);

        const req = http.request(options, (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            const body = Buffer.concat(chunks).toString();
            // Convert http.IncomingMessage to Response-like object
            const responseInit: ResponseInit = {
              status: res.statusCode || 200,
              statusText: res.statusMessage || 'OK',
              headers: new Headers(res.headers as HeadersInit),
            };
            resolve(new Response(body, responseInit));
          });
        });

        req.on('error', (error) => {
          reject(error);
        });

        req.write(bodyString);
        req.end();
      });
      feedbackAuthResponse = response;
    } else {
      // Use fetch for non-localhost URLs
      feedbackAuthResponse = await fetch(fetchUrl, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify(requestBody),
        cache: 'no-store', // Ensure no caching
      });
    }

    console.log('[feedback-auth] Response status:', feedbackAuthResponse.status);
    console.log('[feedback-auth] Response ok:', feedbackAuthResponse.ok);

    if (!feedbackAuthResponse.ok) {
      const errorData = await feedbackAuthResponse.json().catch(() => ({}));
      console.error('[feedback-auth] A2A agent returned error:', errorData);
      return NextResponse.json(
        {
          error: 'Failed to get feedback auth from A2A agent',
          message: errorData.message || errorData.error || 'Unknown error',
        },
        { status: feedbackAuthResponse.status }
      );
    }

    const feedbackAuthData = await feedbackAuthResponse.json();
    console.log('[feedback-auth] Full response from A2A agent:', JSON.stringify(feedbackAuthData, null, 2));
    console.log('[feedback-auth] Response structure:', {
      success: feedbackAuthData.success,
      hasResponse: !!feedbackAuthData.response,
      responseKeys: feedbackAuthData.response ? Object.keys(feedbackAuthData.response) : [],
      hasFeedbackAuth: !!feedbackAuthData.response?.feedbackAuth,
      hasError: !!feedbackAuthData.response?.error,
      error: feedbackAuthData.response?.error,
    });

    // Check if there's an error in the response
    if (feedbackAuthData.response?.error) {
      console.error('[feedback-auth] A2A agent returned error in response:', feedbackAuthData.response.error);
      return NextResponse.json(
        {
          error: 'A2A agent error',
          message: feedbackAuthData.response.error,
        },
        { status: 400 }
      );
    }

    const feedbackAuthId = feedbackAuthData.response?.feedbackAuth;

    if (!feedbackAuthId) {
      console.error('[feedback-auth] No feedbackAuth in response:', {
        response: feedbackAuthData.response,
        fullData: feedbackAuthData,
      });
      return NextResponse.json(
        { 
          error: 'No feedbackAuth returned by provider',
          details: feedbackAuthData.response || feedbackAuthData,
        },
        { status: 400 }
      );
    }

    console.log('[feedback-auth] Successfully received feedbackAuth:', feedbackAuthId);

    return NextResponse.json({
      feedbackAuthId,
      agentId: agentId || feedbackAuthData.response?.agentId,
      chainId: chainId ? Number(chainId) : feedbackAuthData.response?.chainId,
    });
  } catch (error) {
    console.error('[feedback-auth] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to get feedback auth',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

