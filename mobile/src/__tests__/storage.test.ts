/**
 * The local indexes.
 *
 * These stand in for two endpoints the backend does not have, so their
 * behaviour is load-bearing: a lost requirement id means a requirement the
 * user can no longer reach from the app.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  forgetRequirementId,
  forgetSeller,
  getKnownSellers,
  getRequirementIds,
  rememberRequirementId,
  rememberSeller,
} from '@/storage/localIndex';
import { readJson, writeJson } from '@/storage/keyValue';

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('requirement index', () => {
  test('starts empty', async () => {
    await expect(getRequirementIds()).resolves.toEqual([]);
  });

  test('remembers ids newest first', async () => {
    await rememberRequirementId(1);
    await rememberRequirementId(2);
    await expect(getRequirementIds()).resolves.toEqual(['2', '1']);
  });

  test('normalises numeric and string ids to one representation', async () => {
    await rememberRequirementId(3);
    await rememberRequirementId('3');
    await expect(getRequirementIds()).resolves.toEqual(['3']);
  });

  test('re-remembering moves an id to the front without duplicating it', async () => {
    await rememberRequirementId(1);
    await rememberRequirementId(2);
    await rememberRequirementId(1);
    await expect(getRequirementIds()).resolves.toEqual(['1', '2']);
  });

  test('forgetting removes only the named id', async () => {
    await rememberRequirementId(1);
    await rememberRequirementId(2);
    await forgetRequirementId(1);
    await expect(getRequirementIds()).resolves.toEqual(['2']);
  });

  test('CORRUPT STORAGE READS AS EMPTY rather than crashing the home screen', async () => {
    await AsyncStorage.setItem('index.requirementIds', 'not json at all');
    await expect(getRequirementIds()).resolves.toEqual([]);
  });

  test('a stored value of the wrong shape is discarded', async () => {
    await AsyncStorage.setItem('index.requirementIds', '{"nope":true}');
    await expect(getRequirementIds()).resolves.toEqual([]);
  });

  test('non-string entries are filtered out', async () => {
    await AsyncStorage.setItem('index.requirementIds', '["1", 2, null]');
    await expect(getRequirementIds()).resolves.toEqual(['1']);
  });
});

describe('seller address book', () => {
  test('remembers a seller with its label', async () => {
    await rememberSeller({ id: '2', label: 'Northline Electronics' });
    await expect(getKnownSellers()).resolves.toEqual([{ id: '2', label: 'Northline Electronics' }]);
  });

  test('re-remembering updates the label instead of duplicating the id', async () => {
    await rememberSeller({ id: '2', label: 'Old name' });
    await rememberSeller({ id: '2', label: 'New name' });
    const sellers = await getKnownSellers();
    expect(sellers).toHaveLength(1);
    expect(sellers[0]?.label).toBe('New name');
  });

  test('forgetting removes one seller', async () => {
    await rememberSeller({ id: '2', label: 'A' });
    await rememberSeller({ id: '3', label: 'B' });
    await forgetSeller('2');
    await expect(getKnownSellers()).resolves.toEqual([{ id: '3', label: 'B' }]);
  });

  test('malformed entries are dropped rather than rendered', async () => {
    await AsyncStorage.setItem(
      'index.sellers',
      JSON.stringify([{ id: '2', label: 'Good' }, { id: 3 }, null, 'nope']),
    );
    await expect(getKnownSellers()).resolves.toEqual([{ id: '2', label: 'Good' }]);
  });
});

describe('json helpers', () => {
  test('round-trip a value', async () => {
    await writeJson('k', { a: 1 });
    await expect(readJson('k', null)).resolves.toEqual({ a: 1 });
  });

  test('absent keys return the fallback', async () => {
    await expect(readJson('missing', 'fallback')).resolves.toBe('fallback');
  });
});
