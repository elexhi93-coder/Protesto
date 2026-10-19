/**
 * Geo-spatial distance and calculation utilities
 * Using the Haversine formula for exact ground distance in meters
 */

/**
 * Calculates distance between two GPS coordinates in meters
 * @param {number} lat1 
 * @param {number} lon1 
 * @param {number} lat2 
 * @param {number} lon2 
 * @returns {number} distance in meters
 */
function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
  if (lat1 === lat2 && lon1 === lon2) return 0;
  const R = 6371e3; // Earth's radius in meters
  const rad = Math.PI / 180;
  const phi1 = lat1 * rad;
  const phi2 = lat2 * rad;
  const deltaPhi = (lat2 - lat1) * rad;
  const deltaLambda = (lon2 - lon1) * rad;

  const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
            Math.cos(phi1) * Math.cos(phi2) *
            Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c);
}

/**
 * Fuzzy/Generalized location for crowd heatmaps (privacy protection)
 * Rounds coordinates to ~100m grid so individual tracking by observers is impossible
 * @param {number} lat 
 * @param {number} lon 
 * @returns {{lat: number, lon: number}}
 */
function generalizeCoordinates(lat, lon, precision = 3) {
  const factor = Math.pow(10, precision);
  return {
    lat: Math.round(lat * factor) / factor,
    lon: Math.round(lon * factor) / factor
  };
}

/**
 * Calculates safety corridor recommendations based on current user location,
 * active threat pins, and hospital/shelter locations.
 * @param {number} userLat
 * @param {number} userLng
 * @param {Array} threatPins
 * @param {Array} safeDestinations
 * @returns {Object|null}
 */
function calculateSafeCorridor(userLat, userLng, threatPins = [], safeDestinations = []) {
  if (!userLat || !userLng || safeDestinations.length === 0) return null;

  // Rank safe destinations by Euclidean distance penalty from active threat pins
  const scoredDestinations = safeDestinations.map(dest => {
    const distToDest = calculateDistanceMeters(userLat, userLng, dest.lat, dest.lng);
    
    // Check if any confirmed threat is blocking the path (within 120m of line or destination)
    let threatPenalty = 0;
    threatPins.forEach(threat => {
      const distThreatToDest = calculateDistanceMeters(threat.lat, threat.lng, dest.lat, dest.lng);
      const distUserToThreat = calculateDistanceMeters(userLat, userLng, threat.lat, threat.lng);
      if (distThreatToDest < 150 || distUserToThreat < 80) {
        threatPenalty += 500;
      }
    });

    return {
      destination: dest,
      distanceMeters: distToDest,
      score: distToDest + threatPenalty
    };
  });

  scoredDestinations.sort((a, b) => a.score - b.score);
  return scoredDestinations[0] || null;
}

module.exports = {
  calculateDistanceMeters,
  generalizeCoordinates,
  calculateSafeCorridor
};

