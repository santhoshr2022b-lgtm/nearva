/**
 * Nearva Centralized Category System
 * Source of truth for all categories across the platform.
 */

const NEARVA_CATEGORIES = [
    { id: 'plumber', name: 'Plumber', tamil: 'பிளம்பர்', icon: '🔧', color: 'blue' },
    { id: 'electrician', name: 'Electrician', tamil: 'மின்சார நிபுணர்', icon: '⚡', color: 'yellow' },
    { id: 'cook', name: 'Cook', tamil: 'சமையல்காரர்', icon: '🍳', color: 'orange' },
    { id: 'driver', name: 'Driver', tamil: 'ஓட்டுநர்', icon: '🚗', color: 'gray' },
    { id: 'carpenter', name: 'Carpenter', tamil: 'தச்சர்', icon: '🔨', color: 'amber' },
    { id: 'ac-technician', name: 'AC Technician', tamil: 'ஏசி மெக்கானிக்', icon: '❄️', color: 'cyan' },
    { id: 'mason', name: 'Mason', tamil: 'கொத்தனார்', icon: '🧱', color: 'stone' },
    { id: 'house-cleaning', name: 'House Cleaning', tamil: 'வீடு சுத்தம்', icon: '🧹', color: 'teal' },
    { id: 'two-wheeler-mechanic', name: 'Two Wheeler Mechanic', tamil: 'பைக் மெக்கானிக்', icon: '🏍️', color: 'indigo' },
    { id: 'mobile-repair', name: 'Mobile Repair', tamil: 'செல்போன் சரிசெய்தல்', icon: '📱', color: 'rose' },
    { id: 'refrigerator-repair', name: 'Refrigerator Repair', tamil: 'குளிர்சாதனப் பெட்டி பழுது', icon: '🧊', color: 'blue' },
    { id: 'washing-machine-repair', name: 'Washing Machine Repair', tamil: 'சலவை இயந்திரம் பழுது', icon: '🧺', color: 'indigo' },
    { id: 'ro-water-purifier-service', name: 'RO Water Purifier Service', tamil: 'RO நீர் சுத்திகரிப்பு சேவை', icon: '💧', color: 'sky' },
    { id: 'painter', name: 'Painter', tamil: 'பெயிண்டர்', icon: '🖌️', color: 'pink' },
    { id: 'pest-control', name: 'Pest Control', tamil: 'பூச்சி கட்டுப்பாடு', icon: '🐜', color: 'purple' },
    { id: 'water-tank-cleaning', name: 'Water Tank Cleaning', tamil: 'தண்ணீர் தொட்டி சுத்தம்', icon: '🌊', color: 'blue' },
    { id: 'car-mechanic', name: 'Car Mechanic', tamil: 'கார் மெக்கானிக்', icon: '🏎️', color: 'slate' },
    { id: 'puncture-repair', name: 'Puncture Repair', tamil: 'பஞ்சர் சரிசெய்தல்', icon: '🚲', color: 'orange' },
    { id: 'cctv-installation', name: 'CCTV Installation', tamil: 'CCTV பொருத்துதல்', icon: '📹', color: 'gray' },
    { id: 'laptop-repair', name: 'Laptop Repair', tamil: 'மடிக்கணினி பழுது', icon: '💻', color: 'zinc' },
    { id: 'sofa-cleaning', name: 'Sofa Cleaning', tamil: 'சோபா சுத்தம்', icon: '🛋️', color: 'emerald' },
    { id: 'deep-cleaning', name: 'Deep Cleaning', tamil: 'ஆழ்ந்த சுத்தம்', icon: '🧹', color: 'lime' },
    { id: 'real-estate-agent', name: 'Real Estate Agent', tamil: 'ரியல் எஸ்டேட் முகவர்', icon: '🏠', color: 'violet' }
];

// Helper function to get category by ID
function getCategoryById(id) {
    return NEARVA_CATEGORIES.find(cat => cat.id === id);
}

// Helper function to get categories for registration dropdown
function getCategoryOptions() {
    return NEARVA_CATEGORIES.map(cat => ({
        value: cat.name,
        label: cat.name,
        tamil: cat.tamil
    }));
}
