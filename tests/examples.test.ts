import fs from 'fs';
import path from 'path';
import { JourneySchema } from '../src/types/journey';

test('example journey validates against JourneySchema', () => {
  const p = path.resolve(process.cwd(), 'examples', 'journeys', 'example_journey.json');
  const raw = fs.readFileSync(p, 'utf8');
  const obj = JSON.parse(raw);
  const res = JourneySchema.safeParse(obj);
  expect(res.success).toBe(true);
});
