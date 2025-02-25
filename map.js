// Set your Mapbox access token
mapboxgl.accessToken = 'pk.eyJ1Ijoiem5nZSIsImEiOiJjbTdkdjQzNTYwNnhuMmtvZzNwZnA2ZnZrIn0.DMtQdGrgFuWOd9X_mLRAkw';

let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);
let stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);
let stations = [];
let trips = [];
let filteredTrips = [];
let filteredArrivals = new Map();
let filteredDepartures = new Map();
let filteredStations = [];
let timeFilter = -1;

// Initialize the map
const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027], // Boston area
  zoom: 12,
  minZoom: 5,
  maxZoom: 18
});

let svg;
map.on('load', () => {
  // Append the SVG overlay to the map's canvas container
  svg = d3.select(map.getCanvasContainer())
          .append("svg")
          .attr("class", "d3-overlay")
          .style("position", "absolute")
          .style("top", 0)
          .style("left", 0)
          .style("pointer-events", "none");

  // (Re-)set up your bike lane layers and sources
  console.log("Map loaded successfully");

  map.addSource('boston_bike_lanes', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson'
  });

  map.addLayer({
    id: 'boston-bike-lanes',
    type: 'line',
    source: 'boston_bike_lanes',
    paint: {
      'line-color': '#479e6d',
      'line-width': 5,
      'line-opacity': 0.6
    }
  });
  console.log("Boston bike lanes added");

  map.addSource('cambridge_bike_lanes', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson'
  });

  map.addLayer({
    id: 'cambridge-bike-lanes',
    type: 'line',
    source: 'cambridge_bike_lanes',
    paint: {
      'line-color': '#479e6d',
      'line-width': 5,
      'line-opacity': 0.6
    }
  });
  console.log("Cambridge bike lanes added");

  // Now that the map and overlay are ready, load station & traffic data:
  fetchBluebikeStations();

  d3.csv("https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv")
    .then((data) => {
      console.log("Loaded Traffic Data:", data);

      data.forEach((trip) => {
        trip.started_at = new Date(trip.started_at);
        trip.ended_at = new Date(trip.ended_at);
        
        let startedMinutes = minutesSinceMidnight(trip.started_at);
        let endedMinutes = minutesSinceMidnight(trip.ended_at);
        
        departuresByMinute[startedMinutes].push(trip);
        arrivalsByMinute[endedMinutes].push(trip);
      });

      trips = data;
      calculateTraffic();
    })
    .catch((error) => {
      console.error("Error loading Traffic Data:", error);
    });
});

function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

function fetchBluebikeStations() {
  const jsonurl = "https://dsc106.com/labs/lab07/data/bluebikes-stations.json";

  d3.json(jsonurl)
    .then((jsonData) => {
      console.log("Loaded JSON Data:", jsonData);
      stations = jsonData.data.stations;
      console.log("Stations Array:", stations);
      updateTrafficVisualization(stations);
    })
    .catch((error) => {
      console.error("Error loading JSON:", error);
    });
}

function calculateTraffic() {
  let departures = d3.rollup(
    trips,
    (v) => v.length,
    (d) => d.start_station_id
  );

  let arrivals = d3.rollup(
    trips,
    (v) => v.length,
    (d) => d.end_station_id
  );

  stations = stations.map((station) => {
    let id = station.Number || station.short_name;
    return {
      ...station,
      arrivals: arrivals.get(id) ?? 0,
      departures: departures.get(id) ?? 0,
      totalTraffic: (arrivals.get(id) ?? 0) + (departures.get(id) ?? 0)
    };
  });

  console.log("Updated station data with traffic counts:", stations);
  updateTrafficVisualization(stations);
}

function updateTrafficVisualization(stationData = stations) {
  const maxTraffic = d3.max(stationData, (d) => d.totalTraffic) || 1;

  const radiusScale = d3
    .scaleSqrt()
    .domain([0, maxTraffic])
    .range(timeFilter === -1 ? [0.5, 10] : [1, 20]);

  // Bind data to circles in the SVG overlay
  const circles = svg.selectAll("circle")
    .data(stationData)
    .join("circle")
    .attr("r", (d) => radiusScale(d.totalTraffic))
    .attr("stroke", "white")
    .attr("stroke-width", 1)
    .attr("opacity", 0.6)
    .attr("pointer-events", "auto")
    .style("--color-departures", "steelblue")
    .style("--color-arrivals", "darkorange")
    .style("--departure-ratio", d => d.totalTraffic > 0 ? d.departures / d.totalTraffic : 0)
    .style("--color", "color-mix(in oklch, var(--color-departures) calc(100% * var(--departure-ratio)), var(--color-arrivals))")
    .attr("fill", "var(--color)")
    .each(function (d) {
      d3.select(this).selectAll("title").remove();
      d3.select(this)
        .append("title")
        .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
    });
  
  // Function to update bubble positions on map movement
  function updatePositions() {
    circles
      .attr("cx", (d) => getCoords(d).cx)
      .attr("cy", (d) => getCoords(d).cy);
  }

  // Initial positioning and registering update on map events
  updatePositions();
  map.on("move", updatePositions);
  map.on("zoom", updatePositions);
  map.on("resize", updatePositions);
  map.on("moveend", updatePositions);
}

const timeSlider = document.getElementById('time-slider');
const selectedTime = document.getElementById('selected-time');
const anyTimeLabel = document.getElementById('any-time');

function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

function updateTimeDisplay() {
  timeFilter = Number(timeSlider.value);

  if (timeFilter === -1) {
    selectedTime.textContent = "11:59 PM";
  } else {
    selectedTime.textContent = formatTime(timeFilter);
  }

  filterTripsByTime();
}

timeSlider.addEventListener('input', updateTimeDisplay);
updateTimeDisplay();

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function filterTripsByTime() {
  filteredTrips = timeFilter === -1
    ? trips
    : trips.filter((trip) => {
        const startedMinutes = minutesSinceMidnight(trip.started_at);
        const endedMinutes = minutesSinceMidnight(trip.ended_at);
        return (
          Math.abs(startedMinutes - timeFilter) <= 60 ||
          Math.abs(endedMinutes - timeFilter) <= 60
        );
      });

  filteredDepartures = d3.rollup(
    filteredTrips,
    (v) => v.length,
    (d) => d.start_station_id
  );

  filteredArrivals = d3.rollup(
    filteredTrips,
    (v) => v.length,
    (d) => d.end_station_id
  );

  filteredStations = stations.map((station) => {
    let id = station.Number || station.short_name;
    return {
      ...station,
      arrivals: filteredArrivals.get(id) ?? 0,
      departures: filteredDepartures.get(id) ?? 0,
      totalTraffic: (filteredArrivals.get(id) ?? 0) + (filteredDepartures.get(id) ?? 0)
    };
  });

  console.log("Filtered stations:", filteredStations);
  updateTrafficVisualization(filteredStations);
}

function filterByMinute(tripsByMinute, minute) {
  let minMinute = (minute - 60 + 1440) % 1440;
  let maxMinute = (minute + 60) % 1440;

  if (minMinute > maxMinute) {
    let beforeMidnight = tripsByMinute.slice(minMinute);
    let afterMidnight = tripsByMinute.slice(0, maxMinute);
    return beforeMidnight.concat(afterMidnight).flat();
  } else {
    return tripsByMinute.slice(minMinute, maxMinute).flat();
  }
}
