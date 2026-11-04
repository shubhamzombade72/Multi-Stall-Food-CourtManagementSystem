<?php

namespace Database\Seeders\Demo\Data;

/** Static source data for the Indian demo dataset: stalls, people, places, suppliers and ingredients. All invented. */
final class DemoCatalog
{
    public const STALL_PREFIX = 'DM-';
    public const MARKER = '[DEMO DATA]';
    public const EMAIL_DOMAIN = 'example.test';

    /**
     * 50 stalls, one per cuisine. [cuisine, stall name, dish pools, focus regex (dishes matching come first), ingredient group, secondary menu category?]
     *
     * @return array<int, array{0:string,1:string,2:string[],3:?string,4:string,5:bool}>
     */
    public static function stalls(): array
    {
        return [
            ['North Indian', 'Delhi Darbar Rasoi', ['north'], null, 'veg', true],
            ['South Indian', 'Udupi Annapoorna', ['south'], null, 'south', true],
            ['Maharashtrian', 'Kolhapuri Tadka', ['maha'], '/Kolhapuri|Thalipeeth|Pithla|Zunka|Bharli/i', 'veg', true],
            ['Gujarati', 'Ahmedabad Swad Gujarat', ['gujarati', 'sides'], null, 'veg', false],
            ['Punjabi', 'Amritsari Dhaba', ['punjabi'], null, 'veg', false],
            ['Rajasthani', 'Rajasthan Rasoi', ['rajasthani', 'sides'], null, 'veg', false],
            ['Chinese', 'Dragon Wok Express', ['chinese'], '/Soup|Manchow|Spring Roll|Chopsuey/i', 'chinese', true],
            ['Indo-Chinese', 'Schezwan Street Wok', ['chinese'], '/Schezwan|Manchurian|Chilli|Hakka|Fried Rice/i', 'chinese', false],
            ['Street Food', 'Mumbai Street Bites', ['street'], '/Puri|Bhel|Samosa|Kachori|Chaat/i', 'street', true],
            ['Chaat', 'Delhi Chaat Corner', ['street'], '/Chaat|Papdi|Tikki|Raj Kachori|Dahi/i', 'street', false],
            ['Pav Bhaji', 'Juhu Pav Bhaji Centre', ['street'], '/Pav|Bhaji|Dabeli/i', 'street', false],
            ['South Indian Snacks', 'Madras Tiffin Snacks', ['snacks', 'south'], '/Vada|Bonda|Murukku|Chips|Mixture|Chakli/i', 'south', true],
            ['Maharashtrian Snacks', 'Nashik Snack Katta', ['snacks', 'maha'], '/Chivda|Bhakarwadi|Shankarpali|Vadi|Sabudana|Batata/i', 'street', false],
            ['Biryani', 'Hyderabad Dum Biryani', ['biryani'], '/Biryani/i', 'nonveg', true],
            ['Mughlai', 'Lucknow Nawabi Mughlai', ['biryani'], '/Kebab|Korma|Nihari|Haleem|Galouti|Keema/i', 'nonveg', false],
            ['Tandoor', 'Punjab Tandoor', ['tandoor'], null, 'nonveg', true],
            ['Pizza', 'Pizza Junction Pune', ['pizza'], '/Pizza|Calzone/i', 'fast', true],
            ['Burger', 'Burger Bhaiya', ['burger'], '/Burger/i', 'fast', true],
            ['Sandwich', 'Bombay Sandwich Wala', ['burger'], '/Sandwich|Toast|Club/i', 'fast', false],
            ['Rolls and Wraps', 'Kolkata Roll Express', ['rolls'], '/Roll|Wrap|Frankie/i', 'fast', false],
            ['Momos', 'Darjeeling Momo House', ['rolls'], '/Momo|Thukpa/i', 'chinese', true],
            ['Pasta', 'Italiano Pasta Point', ['pizza'], '/Pasta|Penne|Spaghetti|Lasagna|Mac/i', 'fast', false],
            ['Noodles', 'Hakka Noodle Bar', ['chinese'], '/Noodles|Chowmein|Thukpa/i', 'chinese', false],
            ['Thali', 'Gujarat Thali House', ['thali'], '/Thali/i', 'veg', true],
            ['Snacks', 'Farsan Corner Indore', ['snacks'], null, 'street', true],
            ['Juice', 'Ganesh Juice Centre', ['beverages'], '/Juice|Shot|Coconut/i', 'drinks', false],
            ['Fresh Fruit', 'Phal Bazaar Fresh Fruit', ['beverages'], '/Fruit|Papaya|Sprouts|Salad|Coconut|Juice/i', 'drinks', false],
            ['Milkshakes', 'Thick Shake Junction', ['beverages'], '/Shake|Smoothie|Lassi|Milk/i', 'drinks', false],
            ['Tea and Coffee', 'Cutting Chai Company', ['tea'], '/Chai|Tea|Coffee|Espresso|Latte|Cappuccino|Brew|Kahwa|Chocolate/i', 'drinks', true],
            ['Desserts', 'Meethi Duniya Desserts', ['desserts'], '/Cake|Brownie|Cheesecake|Tiramisu|Mousse|Waffle|Pancake|Pudding|Custard/i', 'dessert', true],
            ['Ice Cream', 'Natural Scoop Ice Creams', ['desserts'], '/Ice Cream|Scoop|Sundae|Cone|Falooda|Split/i', 'dessert', false],
            ['Kulfi', 'Rajwadi Kulfi House', ['desserts'], '/Kulfi|Falooda|Rabdi|Phirni/i', 'dessert', false],
            ['Bakery', 'Irani Cafe Bakery', ['tea'], '/Pastry|Cupcake|Puff|Bun|Pav|Croissant|Cookies|Loaf|Biscuit|Rusk|Tart|Patties/i', 'dessert', true],
            ['Sweets', 'Shree Mithai Mandir', ['desserts'], '/Ladoo|Barfi|Peda|Halwa|Jalebi|Pak|Katli|Rasgulla|Gulab|Rasmalai|Kalakand|Imarti|Soan/i', 'dessert', false],
            ['Maharashtrian Misal', 'Pune Misal House', ['maha', 'street'], '/Misal|Usal|Pav/i', 'veg', true],
            ['Vada Pav', 'Dadar Vada Pav Centre', ['street', 'snacks'], '/Vada Pav|Bhajji|Bhaji|Batata|Pakoda/i', 'street', false],
            ['Dosa', 'Mysore Dosa Mahal', ['south'], '/Dosa|Uttapam/i', 'south', false],
            ['Idli', 'Kanchipuram Idli House', ['south'], '/Idli|Vada|Sambar|Pongal|Upma/i', 'south', false],
            ['Paratha', 'Paratha Gali Delhi', ['paratha'], '/Paratha|Bhatura|Chole/i', 'veg', true],
            ['Seafood', 'Konkan Coastal Seafood', ['seafood', 'sides'], null, 'nonveg', true],
            ['Egg Dishes', 'Anda Ghotala Corner', ['paratha'], '/Egg|Anda|Omelette|Bhurji|Half Fry/i', 'nonveg', false],
            ['Vegetarian Meals', 'Annapurna Veg Meals', ['thali', 'north'], '/Veg|Dal|Combo|Meal|Thali/i', 'veg', true],
            ['Non-Vegetarian Meals', 'Nagpur Saoji Kitchen', ['thali', 'punjabi'], '/Non-Veg|Chicken|Mutton|Fish|Egg/i', 'nonveg', true],
            ['Healthy Food', 'Fit Bharat Healthy Bowl', ['healthy'], null, 'healthy', true],
            ['Salads', 'Green Leaf Salad Bar', ['healthy'], '/Salad|Kachumber|Bowl|Chaat/i', 'healthy', false],
            ['Fast Food', 'Quick Bite Fast Food Hub', ['burger', 'rolls'], null, 'fast', true],
            ['Beverages', 'Thanda Thanda Cool Drinks', ['beverages'], '/Soda|Cooler|Mojito|Lagoon|Jaljeera|Panna|Sharbat|Lemonade|Tea|Water/i', 'drinks', false],
            ['Regional Specials', 'Bharat Regional Specials', ['maha', 'rajasthani', 'gujarati', 'south'], '/Thali|Misal|Dal|Undhiyu|Kolhapuri|Appam|Laal/i', 'veg', true],
            ['Combo Meals', 'Value Combo Bazaar', ['thali', 'burger'], '/Combo|Meal/i', 'fast', false],
            ['Family Meals', 'Parivar Family Feast', ['thali', 'biryani'], '/Family|Feast|Platter|Pack/i', 'nonveg', true],
        ];
    }

    /** @return array<string, string> primary menu category name per cuisine (secondary is always "Sides, Drinks and Sweets"). */
    public static function primaryCategory(string $cuisine): string
    {
        return match ($cuisine) {
            'Chinese', 'Indo-Chinese', 'Noodles' => 'Chinese Specials',
            'Pizza', 'Pasta' => 'Pizza and Pasta',
            'Burger', 'Sandwich', 'Fast Food' => 'Burgers and Snacks',
            'Rolls and Wraps', 'Momos' => 'Rolls, Wraps and Momos',
            'Tea and Coffee' => 'Tea, Coffee and Bakes',
            'Juice', 'Fresh Fruit', 'Milkshakes', 'Beverages' => 'Fresh Drinks',
            'Desserts', 'Ice Cream', 'Kulfi', 'Sweets', 'Bakery' => 'Sweets and Desserts',
            'Thali', 'Vegetarian Meals', 'Non-Vegetarian Meals', 'Combo Meals', 'Family Meals' => 'Meals and Thalis',
            'Maharashtrian Misal', 'Vada Pav', 'Street Food', 'Chaat', 'Pav Bhaji', 'Snacks', 'South Indian Snacks', 'Maharashtrian Snacks' => 'Chaat and Snacks',
            default => $cuisine . ' Specials',
        };
    }

    public const SECONDARY_CATEGORY = 'Sides, Drinks and Sweets';

    /** @return string[] */
    public static function firstNames(): array
    {
        return [
            'Aarav', 'Vihaan', 'Rohan', 'Kabir', 'Arjun', 'Ishaan', 'Siddharth', 'Karan', 'Manish', 'Rahul', 'Sagar', 'Omkar', 'Pratik', 'Nitin', 'Ganesh', 'Sanjay', 'Vijay', 'Amit', 'Deepak', 'Suresh',
            'Priya', 'Anjali', 'Neha', 'Kavita', 'Sneha', 'Pooja', 'Meera', 'Divya', 'Sunita', 'Rekha', 'Shweta', 'Rutuja', 'Pallavi', 'Madhuri', 'Swati', 'Aishwarya', 'Komal', 'Nisha', 'Lata', 'Asha',
            'Imran', 'Farhan', 'Gurpreet', 'Harpreet', 'Vikram', 'Mohammed', 'Salman', 'Zoya', 'Fatima', 'Ayesha', 'Ramesh', 'Mahesh', 'Dinesh', 'Prakash', 'Yogesh', 'Tejas', 'Harsh', 'Jignesh', 'Krishna', 'Lakshmi',
        ];
    }

    /** @return string[] */
    public static function lastNames(): array
    {
        return [
            'Sharma', 'Patil', 'Deshmukh', 'Iyer', 'Reddy', 'Singh', 'Kulkarni', 'Mehta', 'Khan', 'Nair', 'Joshi', 'Gupta', 'Shah', 'Pillai', 'Jadhav', 'More', 'Pawar', 'Shinde', 'Gaikwad', 'Bhosale',
            'Chavan', 'Kadam', 'Salunkhe', 'Thakur', 'Verma', 'Agarwal', 'Patel', 'Desai', 'Naidu', 'Rao', 'Menon', 'Banerjee', 'Chatterjee', 'Kapoor', 'Malhotra', 'Bhatt', 'Solanki', 'Rathod', 'Chauhan', 'Ansari',
        ];
    }

    /** @return array<int, array{0:string,1:string}> city, state */
    public static function cities(): array
    {
        return [
            ['Pune', 'Maharashtra'], ['Mumbai', 'Maharashtra'], ['Nashik', 'Maharashtra'], ['Nagpur', 'Maharashtra'], ['Solapur', 'Maharashtra'], ['Kolhapur', 'Maharashtra'],
            ['Barshi', 'Maharashtra'], ['Hyderabad', 'Telangana'], ['Bengaluru', 'Karnataka'], ['Chennai', 'Tamil Nadu'], ['Delhi', 'Delhi'], ['Ahmedabad', 'Gujarat'],
            ['Jaipur', 'Rajasthan'], ['Indore', 'Madhya Pradesh'],
        ];
    }

    /** @return string[] */
    public static function localities(): array
    {
        return ['Shivaji Nagar', 'Gandhi Chowk', 'Station Road', 'MG Road', 'Nehru Nagar', 'Lokmanya Colony', 'Tilak Road', 'Ambedkar Nagar', 'Model Colony', 'Laxmi Road', 'Civil Lines', 'Camp Area', 'Market Yard', 'Hill View Society', 'Sai Nagar'];
    }

    /** @return string[] */
    public static function supplierPrefixes(): array
    {
        return [
            'Shree Ganesh', 'Jai Malhar', 'Annapurna', 'Sai Krupa', 'Laxmi Narayan', 'Om Sai', 'Balaji', 'Mahalaxmi', 'Siddhivinayak', 'Gajanan', 'Renuka', 'Tulja Bhavani', 'Khandoba', 'Datta',
            'Vitthal', 'Ambika', 'Bharat', 'Kisan', 'Hari Om', 'Raj Rajeshwari', 'Mauli', 'Swami Samarth', 'Ekvira', 'Yashwant', 'Shivneri', 'Sahyadri', 'Godavari', 'Krishna Valley', 'Narmada', 'Kaveri',
            'Himalaya', 'Aravali', 'Malabar', 'Konkan', 'Deccan', 'Marathwada', 'Vidarbha', 'Khandesh', 'Western Ghats', 'Golden Harvest',
        ];
    }

    /** @return array<int, array{0:string,1:string}> supplier type, ingredient group focus */
    public static function supplierTypes(): array
    {
        return [
            ['Fresh Vegetables', 'veg'], ['Dairy Products', 'dairy'], ['Beverage Distributors', 'drinks'], ['Flour and Grains', 'grain'], ['Masala and Spices', 'spice'],
            ['Packaging Supplies', 'pack'], ['Poultry and Meat', 'nonveg'], ['Edible Oils', 'oil'], ['Bakery Ingredients', 'dessert'], ['Seafood Traders', 'nonveg'],
        ];
    }

    /**
     * Ingredient groups: "name|unit|unit cost INR|minimum alert stock|typical purchase quantity". Units: kg, g, litre, ml, packet, piece, box.
     *
     * @return array<string, string[]>
     */
    public static function ingredients(): array
    {
        $staples = ['Refined Sunflower Oil|litre|135|10|40', 'Onion|kg|32|15|60', 'Tomato|kg|40|10|40', 'Disposable Plates|packet|55|10|30', 'Paper Napkins|packet|40|10|30', 'Takeaway Boxes|box|320|3|10', 'Iodised Salt|kg|22|5|20', 'Sugar|kg|44|10|30'];

        return [
            'staples' => $staples,
            'veg' => ['Paneer|kg|340|5|20', 'Atta (Wheat Flour)|kg|42|20|80', 'Basmati Rice|kg|95|15|60', 'Toor Dal|kg|140|8|30', 'Chana (Chickpeas)|kg|110|8|30', 'Rajma|kg|150|5|20', 'Potato|kg|28|20|80', 'Green Chilli|kg|80|2|8', 'Coriander Leaves|kg|60|2|8', 'Ginger Garlic Paste|kg|120|3|10', 'Garam Masala|g|0.75|500|3000', 'Desi Ghee|kg|620|3|12', 'Fresh Cream|litre|220|3|10', 'Curd|kg|70|5|20', 'Cashew|kg|820|1|4', 'Besan|kg|85|8|25'],
            'south' => ['Dosa Batter|kg|60|10|50', 'Idli Rice|kg|55|15|60', 'Urad Dal|kg|130|8|30', 'Toor Dal|kg|140|8|30', 'Coconut (Grated)|kg|120|4|15', 'Sambar Powder|g|0.6|500|3000', 'Tamarind|kg|140|2|8', 'Curry Leaves|g|0.2|200|800', 'Mustard Seeds|g|0.14|300|1000', 'Rava (Semolina)|kg|48|10|30', 'Filter Coffee Powder|kg|520|2|8', 'Ghee|kg|620|3|12', 'Potato|kg|28|20|80', 'Poha|kg|60|5|20', 'Idli Chutney Mix|kg|80|3|10'],
            'street' => ['Pav (Bread Rolls)|packet|30|40|200', 'Potato|kg|28|25|100', 'Boondi|kg|110|3|10', 'Sev|kg|120|5|15', 'Chaat Masala|g|0.8|300|1500', 'Tamarind Chutney|kg|90|3|10', 'Green Chutney|kg|80|3|10', 'Papdi|packet|40|20|80', 'Puri Shells|packet|35|30|100', 'Amul-style Butter|kg|520|3|12', 'Pav Bhaji Masala|g|0.9|300|1500', 'Besan|kg|85|8|25', 'Green Peas|kg|90|5|20', 'Cauliflower|kg|50|5|20', 'Curd|kg|70|5|20'],
            'nonveg' => ['Chicken (Dressed)|kg|230|10|40', 'Mutton|kg|780|5|20', 'Eggs|piece|7|120|600', 'Fish (Surmai/Pomfret)|kg|650|4|15', 'Prawns|kg|620|3|10', 'Basmati Rice|kg|95|15|60', 'Atta (Wheat Flour)|kg|42|20|80', 'Ginger Garlic Paste|kg|120|3|10', 'Biryani Masala|g|1.1|300|1500', 'Tandoori Masala|g|0.95|300|1500', 'Curd|kg|70|5|20', 'Desi Ghee|kg|620|3|12', 'Kashmiri Chilli Powder|g|0.7|500|2000', 'Mint Leaves|kg|90|1|5', 'Lemon|kg|70|2|10'],
            'fast' => ['Burger Buns|packet|45|20|100', 'Pizza Base (8 inch)|packet|60|15|80', 'Mozzarella Cheese|kg|420|5|20', 'Cheese Slices|packet|140|5|20', 'Tomato Ketchup|kg|95|4|15', 'Mayonnaise|kg|160|3|10', 'Potato Fries (Frozen)|kg|120|8|30', 'Veg Patty|packet|180|8|30', 'Chicken Patty|packet|260|6|20', 'Pasta (Penne)|kg|120|5|20', 'Pizza Sauce|kg|130|4|15', 'Lettuce|kg|90|2|8', 'Tortilla Wraps|packet|85|10|40', 'Oregano Seasoning|g|1.2|200|800', 'Soft Drink Syrup|litre|110|5|20'],
            'chinese' => ['Hakka Noodles|kg|90|10|40', 'Soy Sauce|litre|75|3|10', 'Schezwan Sauce|kg|140|3|10', 'Vinegar|litre|45|3|10', 'Spring Onion|kg|50|3|10', 'Cabbage|kg|30|8|25', 'Capsicum|kg|60|5|20', 'Carrot|kg|45|5|20', 'Corn Flour|kg|55|5|20', 'Momo Wrappers|packet|60|15|60', 'Chilli Sauce|kg|110|3|10', 'Basmati Rice|kg|95|15|60', 'Paneer|kg|340|5|20', 'Chicken (Dressed)|kg|230|10|40', 'Garlic|kg|180|3|10'],
            'drinks' => ['Full Cream Milk|litre|58|20|80', 'Tea Leaves (CTC)|kg|320|4|15', 'Coffee Powder|kg|650|2|8', 'Oranges|kg|60|10|40', 'Mosambi|kg|55|10|40', 'Watermelon|kg|22|15|60', 'Mango Pulp|kg|140|5|20', 'Bananas|piece|5|60|300', 'Sugar Syrup|litre|60|5|20', 'Lemon|kg|70|4|15', 'Ice Cubes|kg|8|20|100', 'Mint Leaves|kg|90|1|5', 'Soda Bottles|piece|10|48|240', 'Sugarcane|kg|8|20|100', 'Packaged Water 1L|piece|11|48|240'],
            'dessert' => ['Maida|kg|40|10|40', 'Sugar|kg|44|10|30', 'Full Cream Milk|litre|58|20|80', 'Khoya (Mawa)|kg|420|3|10', 'Desi Ghee|kg|620|3|12', 'Cocoa Powder|g|0.9|300|1500', 'Dark Chocolate|kg|520|3|10', 'Fresh Cream|litre|220|3|10', 'Cardamom|g|3.2|100|300', 'Saffron|g|420|2|8', 'Pista|kg|1500|1|3', 'Almonds|kg|780|1|4', 'Vanilla Ice Cream Base|litre|180|8|30', 'Baking Powder|g|0.3|300|1000', 'Butter|kg|520|4|15', 'Egg Tray (30)|box|210|3|10'],
            'healthy' => ['Sprouts Mix|kg|110|4|15', 'Quinoa|kg|420|2|8', 'Brown Rice|kg|110|8|30', 'Oats|kg|140|4|15', 'Ragi Flour|kg|70|4|15', 'Mixed Greens|kg|90|4|15', 'Cucumber|kg|35|5|20', 'Beetroot|kg|40|4|15', 'Tofu|kg|320|2|8', 'Hung Curd|kg|110|3|10', 'Olive Oil|litre|620|2|6', 'Honey|kg|380|1|4', 'Makhana|kg|900|1|4', 'Moong Dal|kg|130|5|20', 'Mixed Seeds|g|0.8|500|1500'],
        ];
    }

    /** @return string[] */
    public static function sections(): array
    {
        return ['Main Hall', 'Patio and Garden', 'Family Lounge', 'Quick Bites Counter', 'AC Dining Zone', 'Food Street Wing', 'Rooftop Deck', 'Courtyard'];
    }
}
