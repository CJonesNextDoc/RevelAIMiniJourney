import buildApp from '../src/app';

describe('health route', () => {
  test('returns status ok', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.payload);
    expect(json).toHaveProperty('status', 'ok');

    await app.close();
  });
});
