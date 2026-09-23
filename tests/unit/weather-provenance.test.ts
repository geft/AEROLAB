import { describe, expect, it } from 'vitest';
import { verifiedAmbientTemperature } from '../../src/backend/physiology/weather.js';

describe('ambient weather provenance', () => {
  it('uses only explicitly sourced ambient temperature for heat analysis', () => {
    expect(verifiedAmbientTemperature({ weather_source: 'open-meteo', weather_temperature_c: 31 })).toBe(31);
    expect(verifiedAmbientTemperature({ weather_source: 'open-meteo', weather_temperature_c: null })).toBeNull();
    expect(verifiedAmbientTemperature({ weather_source: null, weather_temperature_c: 31 })).toBeNull();
    expect(verifiedAmbientTemperature({ weather_temperature_c: null })).toBeNull();
  });
});
