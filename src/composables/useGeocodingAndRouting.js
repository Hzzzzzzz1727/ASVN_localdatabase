// src/composables/useGeocodingAndRouting.js
import { ref } from 'vue'

export function useGeocodingAndRouting(customersRef) {  // truyền customers từ composable khác vào
  const currentLocation = ref('')
  const currentCoords = ref(null)
  const showRouteModal = ref(false)
  const routeCustomers = ref([])
  const isLoadingRoute = ref(false)
  const geocodeCache = new Map()
  const routeDistanceCache = new Map()

  const openRouteModal = () => {
    showRouteModal.value = true
    currentLocation.value = ''
    currentCoords.value = null
    routeCustomers.value = []
    isLoadingRoute.value = false
  }

  const closeRouteModal = () => {
    showRouteModal.value = false
  }

  // Geocode địa chỉ (giữ nguyên logic cũ, chỉ tinh chỉnh)
  const geocodeAddress = async (address) => {
    if (!address || !address.trim()) return null
    const normalizedAddress = address.trim()
    if (geocodeCache.has(normalizedAddress)) return geocodeCache.get(normalizedAddress)

    const photonBase = 'https://photon.komoot.io/api/?limit=1&lang=vi&q='
    const nominatimBase = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&q='

    const variants = [
      address,
      `${address}, Da Nang, Vietnam`,
      `${address}, Đà Nẵng, Việt Nam`,
      address.replace('(Cũ)', '').replace('(cũ)', '').trim() + ', Da Nang, Vietnam',
      address.replace('TP Đà Nẵng', 'Da Nang').trim() + ', Vietnam',
      address.replace(/quận/i, 'Quận').replace(/phường/i, 'Phường').trim() + ', Da Nang',
      address.split(',')[0].trim() + ', Da Nang, Vietnam'
    ]

    for (const variant of variants) {
      try {
        // Photon trước
        let res = await fetch(`${photonBase}${encodeURIComponent(variant)}`)
        let json = await res.json()
        if (json?.features?.length) {
          const f = json.features[0]
          const [lon, lat] = f.geometry.coordinates
          console.log('[Photon OK]', variant)
          const result = { lat: parseFloat(lat), lng: parseFloat(lon), displayName: f.properties.name || f.properties.label }
          geocodeCache.set(normalizedAddress, result)
          return result
        }

        // Fallback Nominatim
        res = await fetch(`${nominatimBase}${encodeURIComponent(variant)}`)
        json = await res.json()
        if (json?.length > 0) {
          console.log('[Nominatim OK]', variant)
          const result = { lat: parseFloat(json[0].lat), lng: parseFloat(json[0].lon), displayName: json[0].display_name }
          geocodeCache.set(normalizedAddress, result)
          return result
        }
      } catch (err) {
        console.warn('[Geocode Error]', variant, err.message)
      }
    }
    console.warn('[Geocode Fail]', address)
    geocodeCache.set(normalizedAddress, null)
    return null
  }

  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371
    const dLat = (lat2 - lat1) * Math.PI / 180
    const dLon = (lon2 - lon1) * Math.PI / 180
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return R * c
  }

  const getRouteDistanceMeters = async (from, to) => {
    if (!from || !to) return null
    const cacheKey = `${from.lat},${from.lng}|${to.lat},${to.lng}`
    if (routeDistanceCache.has(cacheKey)) return routeDistanceCache.get(cacheKey)
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false`
      const res = await fetch(url)
      const json = await res.json()
      if (json.code === 'Ok' && json.routes?.length) {
        const distance = json.routes[0].distance
        routeDistanceCache.set(cacheKey, distance)
        return distance // meters
      }
    } catch (e) {
      console.warn('[OSRM Error]', e.message)
    }
    routeDistanceCache.set(cacheKey, null)
    return null
  }

  const calculateRoute = async () => {
    if (!currentLocation.value.trim()) {
      alert('Vui lòng nhập địa chỉ hiện tại của bạn')
      return
    }

    isLoadingRoute.value = true

    let coords = await geocodeAddress(currentLocation.value)
    if (!coords) coords = await geocodeAddress(currentLocation.value + ', Đà Nẵng, Việt Nam')

    if (!coords) {
      alert('Không tìm thấy tọa độ cho địa chỉ hiện tại. Hãy nhập chi tiết hơn (số nhà, đường, phường, quận).')
      isLoadingRoute.value = false
      return
    }

    currentCoords.value = coords

    const customersToRoute = customersRef.value.filter(c => c.status === 0) // chỉ ca đang làm
    const customersWithDistance = []

    for (let i = 0; i < customersToRoute.length; i++) {
      const customer = customersToRoute[i]
      if (i > 0) await new Promise(r => setTimeout(r, 1200)) // rate limit

      let distance = 'N/A'
      let customerCoords = null
      let displayAddress = customer.address || 'Không có địa chỉ'
      let status = 'OK'

      if (customer.address?.trim()) {
        customerCoords = await geocodeAddress(customer.address)
        if (customerCoords) {
          const meters = await getRouteDistanceMeters(coords, customerCoords)
          distance = meters !== null ? (meters / 1000).toFixed(2) : calculateDistance(coords.lat, coords.lng, customerCoords.lat, customerCoords.lng).toFixed(2)
          displayAddress = customerCoords.displayName || customer.address
        } else {
          status = 'Không tìm được tọa độ'
        }
      } else {
        status = 'Không có địa chỉ'
      }

      customersWithDistance.push({
        ...customer,
        distance,
        status,
        coords: customerCoords,
        displayAddress
      })
    }

    routeCustomers.value = customersWithDistance.sort((a, b) => {
      if (a.distance === 'N/A') return 1
      if (b.distance === 'N/A') return -1
      return parseFloat(a.distance) - parseFloat(b.distance)
    })

    isLoadingRoute.value = false
  }

  return {
    currentLocation,
    currentCoords,
    showRouteModal,
    routeCustomers,
    isLoadingRoute,
    openRouteModal,
    closeRouteModal,
    calculateRoute
  }
}
