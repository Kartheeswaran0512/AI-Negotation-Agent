/**
 * The HTTP client, against a stubbed fetch.
 *
 * What matters here is not that fetch works, but that this layer translates
 * the backend's single error envelope into something screens can act on: a
 * 409 must be distinguishable from a 422, a validation error must surface its
 * field list, and an unreachable server must not look like a server error.
 */

import { ApiError, normaliseBaseUrl, request, type ApiCredentials } from '@/api/client';

const credentials: ApiCredentials = {
  baseUrl: 'http://localhost:3000',
  apiKey: 'test-key',
  userId: 7,
};

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const mockFetch = jest.fn();

beforeEach(() => {
  mockFetch.mockReset();
  global.fetch = mockFetch as unknown as typeof fetch;
});

describe('normaliseBaseUrl', () => {
  test('strips trailing slashes so paths never double up', () => {
    expect(normaliseBaseUrl('http://localhost:3000/')).toBe('http://localhost:3000');
    expect(normaliseBaseUrl('  http://localhost:3000///  ')).toBe('http://localhost:3000');
  });

  test('an empty address is a configuration error, reported as such', () => {
    expect(() => normaliseBaseUrl('   ')).toThrow(ApiError);
  });
});

describe('request', () => {
  test('sends the auth headers the backend expects', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { ok: true }));

    await request(credentials, '/api/requirements/1');

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3000/api/requirements/1');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('test-key');
    expect(headers['x-user-id']).toBe('7');
  });

  test('omits credentials that are not configured', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { ok: true }));

    await request({ baseUrl: 'http://localhost:3000' }, '/health');

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBeUndefined();
    expect(headers['x-user-id']).toBeUndefined();
    expect(headers['content-type']).toBeUndefined();
  });

  test('serialises a body and sets the content type', async () => {
    mockFetch.mockResolvedValue(jsonResponse(201, { ok: true }));

    await request(credentials, '/api/requirements', { method: 'POST', body: { product: 'x' } });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"product":"x"}');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
  });

  test('returns the parsed body on success', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { ok: true, requirement: { id: 1 } }));

    const result = await request<{ ok: boolean; requirement: { id: number } }>(
      credentials,
      '/api/requirements/1',
    );

    expect(result.requirement.id).toBe(1);
  });

  test('turns the error envelope into an ApiError carrying the server message', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(409, {
        ok: false,
        error: { message: 'only the buyer who owns this requirement can accept', details: null },
      }),
    );

    await expect(request(credentials, '/api/negotiations/1/accept', { method: 'POST' })).rejects.toMatchObject(
      {
        status: 409,
        message: 'only the buyer who owns this requirement can accept',
      },
    );
  });

  test('a 409 is a conflict, not a validation error', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(409, { ok: false, error: { message: 'nope', details: null } }),
    );

    const error = await request(credentials, '/api/x').catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).isConflict).toBe(true);
    expect((error as ApiError).isValidationError).toBe(false);
  });

  test('EXPOSES FIELD ERRORS so a form can point at the right input', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(422, {
        ok: false,
        error: {
          message: 'request validation failed',
          details: [
            { field: 'price_basis', message: 'Invalid option' },
            { field: 'target_price', message: 'Required' },
          ],
        },
      }),
    );

    const error = (await request(credentials, '/api/requirements', {
      method: 'POST',
      body: {},
    }).catch((thrown: unknown) => thrown)) as ApiError;

    expect(error.isValidationError).toBe(true);
    expect(error.fieldErrors()).toEqual({
      price_basis: 'Invalid option',
      target_price: 'Required',
    });
  });

  test('a 401 is reported as unauthorized so the UI can point at Settings', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(401, { ok: false, error: { message: 'invalid or missing x-api-key', details: null } }),
    );

    const error = (await request(credentials, '/api/x').catch((thrown: unknown) => thrown)) as ApiError;
    expect(error.isUnauthorized).toBe(true);
  });

  test('AN UNREACHABLE SERVER IS STATUS 0, NOT A SERVER ERROR', async () => {
    mockFetch.mockRejectedValue(new TypeError('Network request failed'));

    const error = (await request(credentials, '/health').catch((thrown: unknown) => thrown)) as ApiError;
    expect(error.isNetworkError).toBe(true);
    expect(error.status).toBe(0);
    expect(error.message).toMatch(/could not reach the server/i);
  });

  test('a non-JSON body still fails cleanly rather than throwing a parse error', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => '<html>Bad Gateway</html>',
    } as unknown as Response);

    const error = (await request(credentials, '/api/x').catch((thrown: unknown) => thrown)) as ApiError;
    expect(error.status).toBe(502);
    expect(error.message).toMatch(/502/);
  });

  test('an empty 200 body is not an error', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => '' } as unknown as Response);

    await expect(request(credentials, '/api/x')).resolves.toBeNull();
  });
});
