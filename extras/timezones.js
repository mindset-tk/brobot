// Mostly complete. Uses many "regions" for when multiple countries
// share the same time and daylight savings observance.  However,
// if a time zone has a special abbreviation it always gets its
// own entry (EG, Moscow shares a time zone with Turkey, but has
// its own abbreviation in the moment-timezone database.)
// therefore this arr should have every extant offset and abbr
// with exception of Israel and certain unrecognized zones such as
// the 45 minute offset zones in the australian outback.
const LOCAL_TIMEZONES = [
  {
    name: 'Date Line West (UTC-12)',
    region: 'East Pacific',
    offset: -12,
    locale: 'Etc/GMT+12',
  },
  {
    name: 'Central Pacific (UTC-11)',
    region: 'East Pacific',
    offset: -11,
    locale: 'Pacific/Niue',
  },
  {
    name: 'French Polynesia (UTC-10)',
    region: 'East Pacific',
    offset: -10,
    locale: 'Pacific/Tahiti',
  },
  {
    name: 'Hawaii Time (DST)',
    region: 'East Pacific',
    offset: -10,
    locale: 'Pacific/Honolulu',
  },
  {
    name: 'Hawaii Time (no DST)',
    region: 'East Pacific',
    offset: -10,
    locale: 'America/Adak',
  },
  {
    name: 'Marquesas',
    region: 'East Pacific',
    offset: -9.5,
    locale: 'Pacific/Marquesas',
  },
  {
    name: 'Gambier',
    region: 'East Pacific',
    offset: -9,
    locale: 'Pacific/Gambier',
  },
  {
    name: 'Pitcairn',
    region: 'East Pacific',
    offset: -8,
    locale: 'Pacific/Pitcairn',
  },
  {
    name: 'Alaska Time',
    region: 'North America',
    offset: -9,
    locale: 'America/Anchorage',
  },
  {
    name: 'Pacific Time',
    region: 'North America',
    offset: -8,
    locale: 'America/Los_angeles',
  },
  {
    name: 'Mountain Time (no DST)',
    region: 'North America',
    offset: -7,
    locale: 'America/Phoenix',
  },
  {
    name: 'Mountain Time (DST)',
    region: 'North America',
    offset: -7,
    locale: 'America/Denver',
  },
  {
    name: 'Central Time',
    region: 'North America',
    offset: -6,
    locale: 'America/Chicago',
  },
  {
    name: 'Saskatchewan',
    region: 'North America',
    offset: -6,
    locale: 'America/Regina',
  },
  {
    name: 'Eastern Time',
    region: 'North America',
    offset: -5,
    locale: 'America/New_York',
  },
  {
    name: 'Atlantic Time',
    region: 'North America',
    offset: -4,
    locale: 'America/Halifax',
  },
  {
    name: 'Newfoundland',
    region: 'North America',
    offset: -3.5,
    locale: 'America/St_Johns',
  },
  {
    name: 'West Greenland Time',
    region: 'North America',
    offset: -3,
    locale: 'America/Miquelon',
  },
  {
    name: 'East Greenland Time',
    region: 'North America',
    offset: -1,
    locale: 'America/Scoresbysund',
  },
  {
    name: 'Zona Noroeste',
    region: 'Central America/Carribean',
    offset: -8,
    locale: 'America/Tijuana',
  },
  {
    name: 'Zona Pacifico (DST)',
    region: 'Central America/Carribean',
    offset: -7,
    locale: 'America/Chihuahua',
  },
  {
    name: 'Zona Pacifico (no DST)',
    region: 'Central America/Carribean',
    offset: -7,
    locale: 'America/Hermosillo',
  },
  {
    name: 'Zona Centro',
    region: 'Central America/Carribean',
    offset: -6,
    locale: 'America/Mexico_City',
  },
  {
    name: 'Central America Time',
    region: 'Central America/Carribean',
    offset: -6,
    locale: 'America/Costa_Rica',
  },
  {
    name: 'Zona Sureste',
    region: 'Central America/Carribean',
    offset: -5,
    locale: 'America/Cancun',
  },
  {
    name: 'Cuba',
    region: 'Central America/Carribean',
    offset: -5,
    locale: 'America/Havana',
  },
  {
    name: 'Puerto Rico',
    region: 'Central America/Carribean',
    offset: -4,
    locale: 'America/Puerto_Rico',
  },
  {
    name: 'Easter Island',
    region: 'South America',
    offset: -6,
    locale: 'Pacific/Easter',
  },
  {
    name: 'Galapagos',
    region: 'South America',
    offset: -6,
    locale: 'Pacific/Galapagos',
  },
  {
    name: 'Western South America (UTC-5)',
    region: 'South America',
    offset: -5,
    locale: 'America/Rio_Branco',
  },
  {
    name: 'Continental Chile',
    region: 'South America',
    offset: -4,
    locale: 'America/Santiago',
  },
  {
    name: 'Central South America (UTC-4)',
    region: 'South America',
    offset: -4,
    locale: 'America/Caracas',
  },
  {
    name: 'Eastern South America (UTC-3)',
    region: 'South America',
    offset: -3,
    locale: 'America/Argentina/Buenos_Aires',
  },
  {
    name: 'Fernando de Noronha',
    region: 'South America',
    offset: -2,
    locale: 'America/Noronha',
  },
  {
    name: 'Cape Verde',
    region: 'Africa',
    offset: -1,
    locale: 'Atlantic/Cape_Verde',
  },
  {
    name: 'Ivory Coast region (UTC)',
    region: 'Africa',
    offset: 0,
    locale: 'Africa/Abidjan',
  },
  {
    name: 'West Africa Time',
    region: 'Africa',
    offset: 1,
    locale: 'Africa/Lagos',
  },
  {
    name: 'Central Africa Time',
    region: 'Africa',
    offset: 2,
    locale: 'Africa/Maputo',
  },
  {
    name: 'Egypt Time',
    region: 'Africa',
    offset: 2,
    locale: 'Africa/Cairo',
  },
  {
    name: 'East Africa Time',
    region: 'Africa',
    offset: 3,
    locale: 'Africa/Nairobi',
  },
  {
    name: 'Morocco (UTC during Ramadan)',
    region: 'Africa',
    offset: 1,
    locale: 'Africa/Casablanca',
  },
  {
    name: 'Mauritius/Seychelles',
    region: 'Africa',
    offset: 4,
    locale: 'Indian/Mauritius',
  },
  {
    name: 'Azores',
    region: 'Europe',
    offset: -1,
    locale: 'Atlantic/Azores',
  },
  {
    name: 'Iceland',
    region: 'Europe',
    offset: 0,
    locale: 'Atlantic/Reykjavik',
  },
  {
    name: 'Western Europe Time',
    region: 'Europe',
    offset: 0,
    locale: 'Europe/Lisbon',
  },
  {
    name: 'UK',
    region: 'Europe',
    offset: 0,
    locale: 'Europe/London',
  },
  {
    name: 'Ireland',
    region: 'Europe',
    offset: 1,
    locale: 'Europe/Dublin',
  },
  {
    name: 'Central Europe Time',
    region: 'Europe',
    offset: 1,
    locale: 'Europe/Paris',
  },
  {
    name: 'Eastern Europe Time',
    region: 'Europe',
    offset: 2,
    locale: 'Europe/Helsinki',
  },
  {
    name: 'Levant (EET/EEST)',
    region: 'West Asia',
    offset: 2,
    locale: 'Asia/Damascus',
  },
  {
    name: 'Arabia Standard Time',
    region: 'West Asia',
    offset: 3,
    locale: 'Asia/Riyadh',
  },
  {
    name: 'Iran Time',
    region: 'West Asia',
    offset: 3.5,
    locale: 'Asia/Tehran',
  },
  {
    name: 'Gulf Standard Time',
    region: 'West Asia',
    offset: 4,
    locale: 'Asia/Dubai',
  },
  {
    name: 'Kaliningrad (UTC+2)',
    region: 'Europe',
    offset: 2,
    locale: 'Europe/Kaliningrad',
  },
  {
    name: 'Moscow (UTC+3)',
    region: 'Europe',
    offset: 3,
    locale: 'Europe/Moscow',
  },
  {
    name: 'Caucusus region (UTC+4)',
    region: 'Central Asia',
    offset: 4,
    locale: 'Asia/Yerevan',
  },
  {
    name: 'Central Asia (UTC+5)',
    region: 'Central Asia',
    offset: 5,
    locale: 'Asia/Samarkand',
  },
  {
    name: 'Eastern Central Asia (UTC+6)',
    region: 'Central Asia',
    offset: 6,
    locale: 'Asia/Almaty',
  },
  {
    name: 'Krasnoyarsk',
    region: 'Eastern Russia',
    offset: 7,
    locale: 'Asia/Krasnoyarsk',
  },
  {
    name: 'Irkutsk',
    region: 'Eastern Russia',
    offset: 8,
    locale: 'Asia/Irkutsk',
  },
  {
    name: 'Yakutsk',
    region: 'Eastern Russia',
    offset: 9,
    locale: 'Asia/Yakutsk',
  },
  {
    name: 'Vladivostok',
    region: 'Eastern Russia',
    offset: 10,
    locale: 'Asia/Vladivostok',
  },
  {
    name: 'Magadan',
    region: 'Eastern Russia',
    offset: 11,
    locale: 'Asia/Magadan',
  },
  {
    name: 'Kamchatka',
    region: 'Eastern Russia',
    offset: 12,
    locale: 'Asia/Kamchatka',
  },
  {
    name: 'Afghanistan',
    region: 'South Asia',
    offset: 4.5,
    locale: 'Asia/Kabul',
  },
  {
    name: 'Pakistan',
    region: 'South Asia',
    offset: 5,
    locale: 'Asia/Karachi',
  },
  {
    name: 'Maldives',
    region: 'South Asia',
    offset: 5,
    locale: 'Indian/Maldives',
  },
  {
    name: 'India',
    region: 'South Asia',
    offset: 5.5,
    locale: 'Asia/Kolkata',
  },
  {
    name: 'Sri Lanka',
    region: 'South Asia',
    offset: 5.5,
    locale: 'Asia/Colombo',
  },
  {
    name: 'Nepal',
    region: 'South Asia',
    offset: 5.75,
    locale: 'Asia/Kathmandu',
  },
  {
    name: 'Bangladesh/Bhutan',
    region: 'South Asia',
    offset: 6,
    locale: 'Asia/Dhaka',
  },
  {
    name: 'Xinjiang Time',
    region: 'East Asia',
    offset: 6,
    locale: 'Asia/Urumqi',
  },
  {
    name: 'West Mongolia (UTC+7)',
    region: 'East Asia',
    offset: 7,
    locale: 'Asia/Hovd',
  },
  {
    name: 'East Mongolia (UTC+8)',
    region: 'East Asia',
    offset: 8,
    locale: 'Asia/Ulaanbaatar',
  },
  {
    name: 'China Standard Time',
    region: 'East Asia',
    offset: 8,
    locale: 'Asia/Shanghai',
  },
  {
    name: 'Hong Kong',
    region: 'East Asia',
    offset: 8,
    locale: 'Asia/Hong_Kong',
  },
  {
    name: 'RoC Standard Time',
    region: 'East Asia',
    offset: 8,
    locale: 'Asia/Taipei',
  },
  {
    name: 'Korea (North & South)',
    region: 'East Asia',
    offset: 9,
    locale: 'Asia/Seoul',
  },
  {
    name: 'Japan',
    region: 'East Asia',
    offset: 9,
    locale: 'Asia/Tokyo',
  },
  {
    name: 'Myanmar/Cocos',
    region: 'Southeast Asia',
    offset: 6.5,
    locale: 'Asia/Yangon',
  },
  {
    name: 'Indochina Time',
    region: 'Southeast Asia',
    offset: 7,
    locale: 'Asia/Bangkok',
  },
  {
    name: 'Christmas Islands',
    region: 'Southeast Asia',
    offset: 7,
    locale: 'Indian/Christmas',
  },
  {
    name: 'West Indonesia Time',
    region: 'Southeast Asia',
    offset: 7,
    locale: 'Asia/Jakarta',
  },
  {
    name: 'Central Indonesia Time',
    region: 'Southeast Asia',
    offset: 8,
    locale: 'Asia/Makassar',
  },
  {
    name: 'Malaysia/Singapore',
    region: 'Southeast Asia',
    offset: 8,
    locale: 'Asia/Singapore',
  },
  {
    name: 'Phillipines',
    region: 'Southeast Asia',
    offset: 8,
    locale: 'Asia/Manila',
  },
  {
    name: 'Eastern Indonesia Time',
    region: 'Southeast Asia',
    offset: 9,
    locale: 'Asia/Jayapura',
  },
  {
    name: 'Timor-Leste',
    region: 'Southeast Asia',
    offset: 9,
    locale: 'Asia/Dili',
  },
  {
    name: 'Australian Western Time',
    region: 'Oceania',
    offset: 8,
    locale: 'Australia/Perth',
  },
  {
    name: 'Palau',
    region: 'Oceania',
    offset: 9,
    locale: 'Pacific/Palau',
  },
  {
    name: 'Australian Central Time (no DST)',
    region: 'Oceania',
    offset: 9.5,
    locale: 'Australia/Darwin',
  },
  {
    name: 'Australian Central Time (DST)',
    region: 'Oceania',
    offset: 9.5,
    locale: 'Australia/Adelaide',
  },
  {
    name: 'Micronesia & Melanesia (UTC+10)',
    region: 'Oceania',
    offset: 10,
    locale: 'Pacific/Port_Moresby',
  },
  {
    name: 'Australian Eastern Time (no DST)',
    region: 'Oceania',
    offset: 10,
    locale: 'Australia/Brisbane',
  },
  {
    name: 'Australian Eastern Time (DST)',
    region: 'Oceania',
    offset: 10,
    locale: 'Australia/Sydney',
  },
  {
    name: 'Lord Howe Island',
    region: 'West Pacific',
    offset: 10.5,
    locale: 'Australia/Lord_Howe',
  },
  {
    name: 'Norfolk Island',
    region: 'West Pacific',
    offset: 11,
    locale: 'Pacific/Norfolk',
  },
  {
    name: 'Eastern Melanesia (UTC+11)',
    region: 'West Pacific',
    offset: 11,
    locale: 'Pacific/Efate',
  },
  {
    name: 'New Zealand Time',
    region: 'West Pacific',
    offset: 12,
    locale: 'Pacific/Auckland',
  },
  {
    name: 'Fiji',
    region: 'West Pacific',
    offset: 12,
    locale: 'Pacific/Fiji',
  },
  {
    name: 'Micronesia & Polynesia (UTC+12)',
    region: 'West Pacific',
    offset: 12,
    locale: 'Pacific/Tarawa',
  },
  {
    name: 'Chatham Islands',
    region: 'West Pacific',
    offset: 12.75,
    locale: 'Pacific/Chatham',
  },
  {
    name: 'Eastern Polynesia (UTC+13)',
    region: 'West Pacific',
    offset: 13,
    locale: 'Pacific/Tongatapu',
  },
  {
    name: 'Line Islands (UTC+14)',
    region: 'West Pacific',
    offset: 14,
    locale: 'Pacific/Kiritimati',
  },
];

const UTC_TIMEZONES = {
  'GMT+14': 'Etc/GMT-14',
  'GMT+13': 'Etc/GMT-13',
  'GMT+12': 'Etc/GMT-12',
  'GMT+11': 'Etc/GMT-11',
  'GMT+10': 'Etc/GMT-10',
  'GMT+9': 'Etc/GMT-9',
  'GMT+8': 'Etc/GMT-8',
  'GMT+7': 'Etc/GMT-7',
  'GMT+6': 'Etc/GMT-6',
  'GMT+5': 'Etc/GMT-5',
  'GMT+4': 'Etc/GMT-4',
  'GMT+3': 'Etc/GMT-3',
  'GMT+2': 'Etc/GMT-2',
  'GMT+1': 'Etc/GMT-1',
  'GMT+0': 'Etc/GMT',
  'GMT-0': 'Etc/GMT',
  'GMT': 'Etc/GMT',
  'GMT-1': 'Etc/GMT+1',
  'GMT-2': 'Etc/GMT+2',
  'GMT-3': 'Etc/GMT+3',
  'GMT-4': 'Etc/GMT+4',
  'GMT-5': 'Etc/GMT+5',
  'GMT-6': 'Etc/GMT+6',
  'GMT-7': 'Etc/GMT+7',
  'GMT-8': 'Etc/GMT+8',
  'GMT-9': 'Etc/GMT+9',
  'GMT-10': 'Etc/GMT+10',
  'GMT-11': 'Etc/GMT+11',
  'GMT-12': 'Etc/GMT+12',
  'UTC+14': 'Etc/GMT-14',
  'UTC+13': 'Etc/GMT-13',
  'UTC+12': 'Etc/GMT-12',
  'UTC+11': 'Etc/GMT-11',
  'UTC+10': 'Etc/GMT-10',
  'UTC+9': 'Etc/GMT-9',
  'UTC+8': 'Etc/GMT-8',
  'UTC+7': 'Etc/GMT-7',
  'UTC+6': 'Etc/GMT-6',
  'UTC+5': 'Etc/GMT-5',
  'UTC+4': 'Etc/GMT-4',
  'UTC+3': 'Etc/GMT-3',
  'UTC+2': 'Etc/GMT-2',
  'UTC+1': 'Etc/GMT-1',
  'UTC+0': 'Etc/GMT',
  'UTC-0': 'Etc/GMT',
  'UTC': 'Etc/GMT',
  'UTC-1': 'Etc/GMT+1',
  'UTC-2': 'Etc/GMT+2',
  'UTC-3': 'Etc/GMT+3',
  'UTC-4': 'Etc/GMT+4',
  'UTC-5': 'Etc/GMT+5',
  'UTC-6': 'Etc/GMT+6',
  'UTC-7': 'Etc/GMT+7',
  'UTC-8': 'Etc/GMT+8',
  'UTC-9': 'Etc/GMT+9',
  'UTC-10': 'Etc/GMT+10',
  'UTC-11': 'Etc/GMT+11',
  'UTC-12': 'Etc/GMT+12',
};


module.exports = {
  LOCAL_TIMEZONES,
  UTC_TIMEZONES,
};