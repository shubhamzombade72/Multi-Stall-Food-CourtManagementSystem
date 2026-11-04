<?php

namespace App\Services\TestData;

/**
 * Static source data for the bulk test-data generator (see BulkTestDataService).
 *
 * Every cuisine lists 3 stall names and 22 dishes. A dish line is "Name|Menu category|price INR|veg(1)/non-veg(0)|prep minutes".
 * Each generated stall picks 20 of its cuisine's 22 dishes, starting at a different offset per stall, so two stalls of the
 * same cuisine do not carry an identical menu. All values are invented; nothing here is a real business or account.
 */
final class TestDataCatalog
{
    /** @return array<string, array{names: string[], items: string[]}> */
    public static function cuisines(): array
    {
        return [
            'North Indian' => [
                'names' => ['Tandoor Tales', 'Delhi Darbar Kitchen', 'Royal Rasoi'],
                'items' => [
                    'Paneer Tikka|Starters|240|1|15', 'Chicken Tikka|Starters|280|0|18', 'Hara Bhara Kebab|Starters|190|1|15', 'Seekh Kebab|Starters|290|0|20',
                    'Dal Makhani|Mains|220|1|15', 'Butter Chicken|Mains|320|0|20', 'Paneer Butter Masala|Mains|260|1|18', 'Kadai Paneer|Mains|265|1|18',
                    'Chicken Curry|Mains|300|0|20', 'Rajma Chawal|Mains|170|1|15', 'Chole Bhature|Mains|160|1|12', 'Malai Kofta|Mains|255|1|18',
                    'Mutton Rogan Josh|Mains|380|0|25', 'Butter Naan|Breads|55|1|8', 'Garlic Naan|Breads|65|1|8', 'Tandoori Roti|Breads|30|1|6',
                    'Laccha Paratha|Breads|50|1|8', 'Jeera Rice|Rice|130|1|10', 'Veg Pulao|Rice|180|1|12', 'Boondi Raita|Sides|70|1|3',
                    'Masala Papad|Sides|50|1|3', 'Gulab Jamun|Desserts|80|1|3',
                ],
            ],
            'South Indian' => [
                'names' => ['Dosa Junction', 'Madras Meals House', 'Udupi Delight'],
                'items' => [
                    'Plain Dosa|Dosa|80|1|10', 'Masala Dosa|Dosa|110|1|12', 'Mysore Masala Dosa|Dosa|130|1|12', 'Rava Dosa|Dosa|120|1|12',
                    'Paper Dosa|Dosa|120|1|12', 'Onion Uttapam|Uttapam|110|1|12', 'Tomato Uttapam|Uttapam|110|1|12', 'Idli Sambar (2 pc)|Tiffin|70|1|8',
                    'Medu Vada (2 pc)|Tiffin|75|1|8', 'Sambar Vada|Tiffin|90|1|8', 'Pongal|Tiffin|95|1|10', 'Upma|Tiffin|70|1|8',
                    'Curd Rice|Rice|90|1|6', 'Lemon Rice|Rice|90|1|8', 'Tamarind Rice|Rice|95|1|8', 'Bisi Bele Bath|Rice|120|1|12',
                    'Veg Meals Thali|Meals|170|1|12', 'Andhra Chicken Fry|Specials|240|0|18', 'Chettinad Chicken Curry|Specials|270|0|20', 'Kerala Parotta|Specials|45|1|8',
                    'Filter Coffee|Beverages|50|1|5', 'Payasam|Desserts|80|1|5',
                ],
            ],
            'Chinese' => [
                'names' => ['Wok This Way', 'Dragon Bowl', 'Golden Chopsticks'],
                'items' => [
                    'Veg Manchow Soup|Soups|110|1|8', 'Hot and Sour Soup|Soups|110|1|8', 'Chicken Sweet Corn Soup|Soups|130|0|8', 'Veg Spring Rolls|Starters|140|1|10',
                    'Chicken Lollipop|Starters|220|0|15', 'Chilli Paneer Dry|Starters|210|1|12', 'Crispy Corn|Starters|170|1|10', 'Veg Manchurian Dry|Starters|180|1|12',
                    'Chicken Manchurian|Starters|230|0|14', 'Veg Hakka Noodles|Noodles|150|1|10', 'Chicken Hakka Noodles|Noodles|190|0|12', 'Schezwan Noodles|Noodles|170|1|10',
                    'Singapore Noodles|Noodles|180|1|12', 'Veg Fried Rice|Rice|150|1|10', 'Chicken Fried Rice|Rice|190|0|12', 'Schezwan Fried Rice|Rice|170|1|10',
                    'Triple Schezwan Rice|Rice|230|0|14', 'Veg Manchurian Gravy|Gravies|190|1|12', 'Chilli Chicken Gravy|Gravies|250|0|15', 'Kung Pao Chicken|Gravies|270|0|15',
                    'Veg Momos (6 pc)|Momos|120|1|10', 'Chicken Momos (6 pc)|Momos|150|0|10',
                ],
            ],
            'Maharashtrian' => [
                'names' => ['Misal Mantra', 'Puneri Zunka Bhakar', 'Kolhapuri Katta'],
                'items' => [
                    'Misal Pav|Breakfast|100|1|10', 'Usal Pav|Breakfast|80|1|8', 'Kanda Poha|Breakfast|60|1|8', 'Sabudana Khichdi|Breakfast|90|1|10',
                    'Thalipeeth with Curd|Breakfast|100|1|12', 'Sabudana Vada|Snacks|80|1|8', 'Kothimbir Vadi|Snacks|90|1|10', 'Batata Vada (2 pc)|Snacks|50|1|6',
                    'Vada Pav|Snacks|30|1|5', 'Zunka Bhakar|Mains|130|1|12', 'Pithla Bhakri|Mains|120|1|12', 'Varan Bhaat|Mains|110|1|10',
                    'Bharli Vangi|Mains|150|1|15', 'Kolhapuri Misal|Mains|120|1|12', 'Tambda Rassa Chicken|Non-Veg|260|0|20', 'Pandhra Rassa Chicken|Non-Veg|260|0|20',
                    'Mutton Sukka|Non-Veg|340|0|25', 'Bombil Fry|Non-Veg|230|0|15', 'Puran Poli|Sweets|90|1|8', 'Shrikhand|Sweets|90|1|3',
                    'Modak (2 pc)|Sweets|80|1|5', 'Sol Kadhi|Beverages|50|1|3',
                ],
            ],
            'Fast Food' => [
                'names' => ['Quick Bite Corner', 'Snack Station 24', 'Crunch Express'],
                'items' => [
                    'Veg Club Sandwich|Sandwiches|130|1|8', 'Grilled Cheese Sandwich|Sandwiches|120|1|8', 'Chicken Club Sandwich|Sandwiches|170|0|10', 'Paneer Tikka Sandwich|Sandwiches|150|1|10',
                    'Veg Wrap|Wraps|120|1|8', 'Paneer Kathi Roll|Wraps|140|1|8', 'Chicken Kathi Roll|Wraps|170|0|10', 'Egg Roll|Wraps|110|0|8',
                    'French Fries|Sides|90|1|6', 'Peri Peri Fries|Sides|110|1|6', 'Onion Rings|Sides|100|1|6', 'Chicken Nuggets (6 pc)|Sides|150|0|8',
                    'Chicken Popcorn|Sides|160|0|8', 'Veg Cheese Burger|Combos|130|1|8', 'Veg Meal Combo|Combos|199|1|10', 'Chicken Meal Combo|Combos|249|0|12',
                    'Hot Dog|Combos|120|0|8', 'Cheese Maggi|Snacks|90|1|6', 'Veg Pasta Cup|Snacks|140|1|8', 'Masala Corn Cup|Snacks|80|1|5',
                    'Cold Coffee|Beverages|110|1|4', 'Choco Brownie|Desserts|100|1|3',
                ],
            ],
            'Pizza' => [
                'names' => ['Slice of Napoli', 'Crust Culture', 'Oven Fresh Pizzeria'],
                'items' => [
                    'Margherita Pizza|Classic Pizzas|229|1|15', 'Farmhouse Pizza|Classic Pizzas|319|1|18', 'Veggie Supreme Pizza|Classic Pizzas|339|1|18', 'Paneer Tikka Pizza|Classic Pizzas|329|1|18',
                    'Mushroom Delight Pizza|Classic Pizzas|319|1|18', 'Corn and Cheese Pizza|Classic Pizzas|289|1|15', 'Pepperoni Pizza|Non-Veg Pizzas|379|0|18', 'BBQ Chicken Pizza|Non-Veg Pizzas|369|0|18',
                    'Chicken Tikka Pizza|Non-Veg Pizzas|369|0|18', 'Peri Peri Chicken Pizza|Non-Veg Pizzas|379|0|18', 'Four Cheese Pizza|Cheese Specials|399|1|18', 'Cheese Burst Margherita|Cheese Specials|349|1|18',
                    'Garlic Bread|Sides|99|1|8', 'Cheesy Garlic Bread|Sides|139|1|8', 'Stuffed Garlic Bread|Sides|159|1|10', 'Veg Pasta Alfredo|Pasta|229|1|12',
                    'Penne Arrabbiata|Pasta|219|1|12', 'Chicken White Sauce Pasta|Pasta|259|0|14', 'Zucchini Garlic Dip|Sides|49|1|2', 'Choco Lava Cake|Desserts|109|1|6',
                    'Tiramisu Cup|Desserts|149|1|3', 'Iced Lemon Tea|Beverages|90|1|3',
                ],
            ],
            'Burger' => [
                'names' => ['Bun and Patty Co', 'Smash House', 'Grill and Stack'],
                'items' => [
                    'Aloo Tikki Burger|Veg Burgers|79|1|6', 'Veg Cheese Burger|Veg Burgers|109|1|7', 'Paneer Crunch Burger|Veg Burgers|139|1|8', 'Mexican Bean Burger|Veg Burgers|129|1|8',
                    'Double Veg Burger|Veg Burgers|159|1|9', 'Mushroom Swiss Burger|Veg Burgers|169|1|9', 'Classic Chicken Burger|Chicken Burgers|149|0|8', 'Zinger Chicken Burger|Chicken Burgers|179|0|9',
                    'BBQ Chicken Burger|Chicken Burgers|189|0|9', 'Double Chicken Burger|Chicken Burgers|229|0|10', 'Peri Peri Chicken Burger|Chicken Burgers|179|0|9', 'Egg and Cheese Burger|Chicken Burgers|139|0|8',
                    'Classic Fries|Sides|89|1|5', 'Cheese Loaded Fries|Sides|139|1|7', 'Chicken Wings (6 pc)|Sides|219|0|12', 'Onion Rings|Sides|99|1|6',
                    'Coleslaw Cup|Sides|59|1|2', 'Burger Meal Combo|Combos|229|1|10', 'Chicken Burger Meal Combo|Combos|279|0|12', 'Chocolate Shake|Beverages|129|1|4',
                    'Fresh Lime Soda|Beverages|60|1|3', 'Apple Pie|Desserts|89|1|4',
                ],
            ],
            'Biryani' => [
                'names' => ['Dum Pukht Biryani House', 'Hyderabadi Handi', 'Biryani Boulevard'],
                'items' => [
                    'Veg Dum Biryani|Veg Biryani|190|1|20', 'Paneer Biryani|Veg Biryani|220|1|20', 'Mushroom Biryani|Veg Biryani|210|1|20', 'Veg Hyderabadi Biryani|Veg Biryani|200|1|20',
                    'Hyderabadi Chicken Biryani|Chicken Biryani|260|0|25', 'Chicken Tikka Biryani|Chicken Biryani|290|0|25', 'Chicken 65 Biryani|Chicken Biryani|280|0|25', 'Lucknowi Chicken Biryani|Chicken Biryani|270|0|25',
                    'Mutton Dum Biryani|Mutton Biryani|360|0|30', 'Mutton Keema Biryani|Mutton Biryani|350|0|30', 'Egg Biryani|Egg Biryani|180|0|18', 'Prawn Biryani|Seafood|340|0|25',
                    'Fish Biryani|Seafood|320|0|25', 'Chicken Family Pack Biryani|Family Packs|780|0|30', 'Veg Family Pack Biryani|Family Packs|560|1|30', 'Mirchi ka Salan|Sides|70|1|5',
                    'Boiled Egg Raita|Sides|60|0|3', 'Onion Raita|Sides|50|1|3', 'Chicken 65|Starters|230|0|15', 'Paneer 65|Starters|210|1|15',
                    'Double Ka Meetha|Desserts|90|1|5', 'Sweet Lassi|Beverages|70|1|3',
                ],
            ],
            'Snacks' => [
                'names' => ['Chaat and Chill', 'Namkeen Nook', 'Munch Box'],
                'items' => [
                    'Samosa (2 pc)|Fried Snacks|40|1|6', 'Kachori with Aloo Sabzi|Fried Snacks|50|1|8', 'Onion Pakoda|Fried Snacks|60|1|8', 'Paneer Pakoda|Fried Snacks|90|1|8',
                    'Bread Pakoda|Fried Snacks|40|1|6', 'Mirchi Bhajji|Fried Snacks|50|1|6', 'Dahi Vada|Chaat|70|1|5', 'Papdi Chaat|Chaat|70|1|5',
                    'Aloo Tikki Chaat|Chaat|80|1|8', 'Sev Puri|Chaat|60|1|5', 'Bhel Puri|Chaat|50|1|5', 'Dahi Puri|Chaat|70|1|5',
                    'Pav Bhaji|Pav Specials|120|1|10', 'Cheese Pav Bhaji|Pav Specials|150|1|12', 'Masala Pav|Pav Specials|80|1|8', 'Vada Pav|Pav Specials|30|1|5',
                    'Grilled Veg Sandwich|Sandwiches|90|1|8', 'Corn Chaat|Sandwiches|70|1|5', 'Masala Peanuts|Dry Snacks|40|1|2', 'Roasted Makhana|Dry Snacks|90|1|2',
                    'Khakhra with Chutney|Dry Snacks|50|1|2', 'Masala Chai|Beverages|30|1|4',
                ],
            ],
            'Beverages' => [
                'names' => ['Sip and Go', 'Chill Zone Drinks', 'The Thirst Trap'],
                'items' => [
                    'Fresh Lime Soda|Coolers|60|1|3', 'Masala Soda|Coolers|60|1|3', 'Blue Lagoon|Mocktails|120|1|4', 'Virgin Mojito|Mocktails|120|1|4',
                    'Watermelon Cooler|Coolers|100|1|4', 'Jaljeera|Coolers|50|1|3', 'Aam Panna|Coolers|70|1|4', 'Buttermilk|Coolers|40|1|2',
                    'Sweet Lassi|Dairy|70|1|3', 'Mango Lassi|Dairy|90|1|3', 'Rose Milk|Dairy|70|1|3', 'Badam Milk|Dairy|90|1|5',
                    'Chocolate Shake|Shakes|130|1|5', 'Strawberry Shake|Shakes|130|1|5', 'Oreo Shake|Shakes|150|1|5', 'Banana Shake|Shakes|110|1|5',
                    'Cold Coffee|Shakes|110|1|5', 'Green Apple Mocktail|Mocktails|130|1|4', 'Mint Lemonade|Coolers|70|1|3', 'Iced Peach Tea|Iced Tea|110|1|3',
                    'Iced Lemon Tea|Iced Tea|100|1|3', 'Packaged Water 1L|Bottled|20|1|1',
                ],
            ],
            'Desserts' => [
                'names' => ['Sweet Tooth Studio', 'Mithai Mahal', 'Dessert Diaries'],
                'items' => [
                    'Gulab Jamun (2 pc)|Indian Sweets|70|1|3', 'Rasmalai (2 pc)|Indian Sweets|110|1|3', 'Jalebi with Rabdi|Indian Sweets|120|1|6', 'Gajar Halwa|Indian Sweets|110|1|5',
                    'Moong Dal Halwa|Indian Sweets|130|1|5', 'Kaju Katli (4 pc)|Indian Sweets|140|1|2', 'Rasgulla (2 pc)|Indian Sweets|70|1|3', 'Kulfi Falooda|Indian Sweets|130|1|4',
                    'Chocolate Brownie|Western Desserts|100|1|3', 'Brownie with Ice Cream|Western Desserts|150|1|5', 'Choco Lava Cake|Western Desserts|120|1|6', 'New York Cheesecake Slice|Western Desserts|170|1|3',
                    'Tiramisu Cup|Western Desserts|160|1|3', 'Blueberry Cheesecake Jar|Western Desserts|160|1|3', 'Fruit Custard|Cold Desserts|90|1|3', 'Phirni|Cold Desserts|90|1|3',
                    'Chocolate Mousse|Cold Desserts|110|1|3', 'Mango Pudding|Cold Desserts|100|1|3', 'Waffle with Chocolate|Waffles|140|1|8', 'Nutella Waffle|Waffles|170|1|8',
                    'Pancake Stack|Waffles|150|1|8', 'Sizzling Brownie|Specials|190|1|8',
                ],
            ],
            'Ice Cream' => [
                'names' => ['Scoop Factory', 'Frosty Cone Parlour', 'Kulfi Kingdom'],
                'items' => [
                    'Vanilla Scoop|Scoops|60|1|2', 'Chocolate Scoop|Scoops|70|1|2', 'Strawberry Scoop|Scoops|70|1|2', 'Butterscotch Scoop|Scoops|70|1|2',
                    'Mango Scoop|Scoops|75|1|2', 'Black Currant Scoop|Scoops|75|1|2', 'Belgian Chocolate Scoop|Scoops|90|1|2', 'Malai Kulfi|Kulfi|60|1|2',
                    'Pista Kulfi|Kulfi|70|1|2', 'Mango Kulfi|Kulfi|70|1|2', 'Kesar Badam Kulfi|Kulfi|80|1|2', 'Matka Kulfi|Kulfi|90|1|2',
                    'Choco Chip Cone|Cones and Cups|80|1|2', 'Waffle Cone Sundae|Cones and Cups|130|1|4', 'Hot Fudge Sundae|Sundaes|160|1|5', 'Brownie Sundae|Sundaes|180|1|6',
                    'Banana Split|Sundaes|190|1|6', 'Fruit Salad with Ice Cream|Sundaes|150|1|5', 'Ice Cream Sandwich|Specials|110|1|3', 'Rolled Ice Cream|Specials|170|1|8',
                    'Milkshake Float|Specials|140|1|5', 'Falooda|Specials|130|1|5',
                ],
            ],
            'Bakery' => [
                'names' => ['Daily Bread Bakehouse', 'Oven Mitt Bakery', 'Crumb and Crust'],
                'items' => [
                    'Butter Croissant|Breads and Buns|70|1|3', 'Chocolate Croissant|Breads and Buns|90|1|3', 'Garlic Bread Loaf|Breads and Buns|110|1|6', 'Brown Bread Loaf|Breads and Buns|55|1|2',
                    'Pav (6 pc)|Breads and Buns|35|1|2', 'Cheese Bun|Breads and Buns|45|1|3', 'Vanilla Cupcake|Cakes|60|1|2', 'Chocolate Cupcake|Cakes|65|1|2',
                    'Black Forest Pastry|Cakes|90|1|2', 'Pineapple Pastry|Cakes|80|1|2', 'Red Velvet Pastry|Cakes|110|1|2', 'Dutch Truffle Pastry|Cakes|100|1|2',
                    'Plum Cake Slice|Cakes|70|1|2', 'Veg Puff|Savouries|30|1|4', 'Paneer Puff|Savouries|40|1|4', 'Chicken Puff|Savouries|45|0|4',
                    'Egg Puff|Savouries|40|0|4', 'Veg Patties|Savouries|40|1|4', 'Jeera Biscuits (200g)|Cookies|70|1|1', 'Choco Chip Cookies (6 pc)|Cookies|120|1|1',
                    'Oatmeal Cookies (6 pc)|Cookies|130|1|1', 'Fruit Tart|Desserts|95|1|2',
                ],
            ],
            'Street Food' => [
                'names' => ['Gully Gourmet', 'Nukkad Chaat Wala', 'Thela Treats'],
                'items' => [
                    'Pani Puri (6 pc)|Chaat|40|1|5', 'Sev Puri|Chaat|50|1|5', 'Ragda Pattice|Chaat|70|1|8', 'Raj Kachori|Chaat|80|1|6',
                    'Dahi Bhalla|Chaat|70|1|5', 'Aloo Chaat|Chaat|60|1|6', 'Chole Kulche|Chaat|90|1|8', 'Egg Bhurji Pav|Pav and Rolls|100|0|8',
                    'Anda Roll|Pav and Rolls|90|0|8', 'Frankie Roll|Pav and Rolls|80|1|6', 'Chicken Frankie|Pav and Rolls|110|0|8', 'Dabeli|Pav and Rolls|40|1|5',
                    'Grilled Sandwich|Pav and Rolls|70|1|6', 'Tawa Pulao|Tawa Specials|120|1|10', 'Tawa Pav Bhaji|Tawa Specials|120|1|10', 'Chilli Potato|Tawa Specials|100|1|8',
                    'Veg Chowmein|Tawa Specials|100|1|8', 'Momos Steamed (6 pc)|Momos and Rolls|90|1|8', 'Fried Momos (6 pc)|Momos and Rolls|110|1|9', 'Sugarcane Juice|Drinks|40|1|3',
                    'Kala Khatta Gola|Drinks|40|1|3', 'Jalebi (100g)|Sweets|50|1|4',
                ],
            ],
            'Punjabi' => [
                'names' => ['Amritsari Dhaba', 'Punjab Da Pind', 'Sarson Da Saag Kitchen'],
                'items' => [
                    'Amritsari Fish Fry|Starters|290|0|18', 'Amritsari Kulcha|Breads|90|1|10', 'Makki Di Roti|Breads|60|1|8', 'Sarson Da Saag|Mains|180|1|15',
                    'Chole Kulcha|Mains|140|1|12', 'Dal Tadka|Mains|170|1|12', 'Dal Makhani|Mains|210|1|15', 'Paneer Lababdar|Mains|260|1|18',
                    'Shahi Paneer|Mains|265|1|18', 'Butter Chicken|Mains|320|0|20', 'Chicken Tikka Masala|Mains|310|0|20', 'Mutton Handi|Mains|390|0|28',
                    'Tandoori Chicken (Half)|Tandoor|290|0|25', 'Paneer Tikka Platter|Tandoor|260|1|18', 'Aloo Paratha with Butter|Paratha|90|1|10', 'Gobi Paratha|Paratha|100|1|10',
                    'Paneer Paratha|Paratha|120|1|10', 'Pyaaz Kulcha|Breads|85|1|10', 'Pindi Chole|Mains|150|1|12', 'Lassi (Large)|Beverages|90|1|3',
                    'Meethi Lassi|Beverages|80|1|3', 'Firni|Desserts|90|1|3',
                ],
            ],
            'Gujarati' => [
                'names' => ['Thali Time Gujarat', 'Swad Saurashtra', 'Dhokla and Co'],
                'items' => [
                    'Khaman Dhokla|Farsan|70|1|6', 'Khandvi|Farsan|80|1|6', 'Fafda Jalebi|Farsan|90|1|6', 'Dhokla Sandwich|Farsan|75|1|6',
                    'Locho|Farsan|80|1|6', 'Handvo|Farsan|85|1|10', 'Sev Tamatar Sabzi|Sabzi|130|1|10', 'Undhiyu|Sabzi|180|1|15',
                    'Ringan Bharta|Sabzi|150|1|12', 'Bhindi Masala|Sabzi|140|1|12', 'Gujarati Dal|Dal and Kadhi|110|1|10', 'Gujarati Kadhi|Dal and Kadhi|100|1|10',
                    'Dal Dhokli|Dal and Kadhi|140|1|15', 'Bajra Rotla|Breads|50|1|8', 'Thepla (3 pc)|Breads|70|1|8', 'Puri (4 pc)|Breads|60|1|8',
                    'Gujarati Thali|Thali|220|1|15', 'Mini Gujarati Thali|Thali|160|1|12', 'Khichdi Kadhi|Thali|150|1|12', 'Masala Chaas|Beverages|40|1|2',
                    'Shrikhand|Sweets|90|1|3', 'Basundi|Sweets|90|1|3',
                ],
            ],
            'Italian' => [
                'names' => ['La Piazza Kitchen', 'Trattoria Verde', 'Nonna Pasta Lab'],
                'items' => [
                    'Bruschetta|Antipasti|160|1|8', 'Caprese Salad|Antipasti|190|1|6', 'Minestrone Soup|Antipasti|150|1|10', 'Stuffed Mushrooms|Antipasti|210|1|12',
                    'Spaghetti Aglio e Olio|Pasta|230|1|12', 'Penne Arrabbiata|Pasta|230|1|12', 'Fettuccine Alfredo|Pasta|250|1|14', 'Pesto Penne|Pasta|250|1|12',
                    'Spaghetti Bolognese|Pasta|280|0|15', 'Chicken Alfredo|Pasta|290|0|15', 'Baked Lasagna Veg|Baked|290|1|20', 'Baked Lasagna Chicken|Baked|330|0|20',
                    'Mac and Cheese|Baked|220|1|14', 'Margherita Pizza|Pizza|240|1|15', 'Quattro Formaggi Pizza|Pizza|360|1|18', 'Chicken Pepperoni Pizza|Pizza|380|0|18',
                    'Mushroom Risotto|Risotto|290|1|20', 'Chicken Risotto|Risotto|320|0|20', 'Garlic Focaccia|Sides|120|1|8', 'Tiramisu|Desserts|170|1|3',
                    'Panna Cotta|Desserts|150|1|3', 'Affogato|Desserts|140|1|4',
                ],
            ],
            'Mexican' => [
                'names' => ['Taco Fiesta', 'El Sombrero Grill', 'Burrito Bandits'],
                'items' => [
                    'Veg Nachos with Salsa|Nachos|170|1|8', 'Cheesy Nachos Supreme|Nachos|210|1|9', 'Chicken Loaded Nachos|Nachos|250|0|10', 'Bean and Cheese Quesadilla|Quesadillas|190|1|10',
                    'Chicken Quesadilla|Quesadillas|230|0|10', 'Paneer Quesadilla|Quesadillas|210|1|10', 'Crunchy Veg Taco (2 pc)|Tacos|160|1|8', 'Soft Chicken Taco (2 pc)|Tacos|210|0|8',
                    'Paneer Taco (2 pc)|Tacos|180|1|8', 'Bean Burrito|Burritos|190|1|10', 'Chicken Burrito|Burritos|240|0|10', 'Paneer Burrito|Burritos|210|1|10',
                    'Burrito Bowl Veg|Bowls|220|1|10', 'Burrito Bowl Chicken|Bowls|270|0|10', 'Mexican Rice|Sides|110|1|8', 'Refried Beans|Sides|100|1|6',
                    'Guacamole with Chips|Sides|160|1|6', 'Jalapeno Poppers|Sides|150|1|8', 'Churros with Chocolate|Desserts|140|1|8', 'Cinnamon Sugar Churros|Desserts|120|1|8',
                    'Fajita Veg Platter|Mains|280|1|14', 'Fajita Chicken Platter|Mains|330|0|14',
                ],
            ],
            'Juice Center' => [
                'names' => ['Fresh Squeeze Bar', 'Pulp Fiction Juices', 'Vitamin Hub'],
                'items' => [
                    'Orange Juice|Fresh Juices|80|1|4', 'Mosambi Juice|Fresh Juices|70|1|4', 'Pineapple Juice|Fresh Juices|80|1|4', 'Watermelon Juice|Fresh Juices|70|1|4',
                    'Pomegranate Juice|Fresh Juices|110|1|5', 'Apple Juice|Fresh Juices|100|1|4', 'Sugarcane Juice|Fresh Juices|50|1|3', 'Carrot Juice|Fresh Juices|70|1|4',
                    'Beetroot Carrot Juice|Health Blends|90|1|4', 'ABC Juice|Health Blends|100|1|5', 'Green Detox Juice|Health Blends|110|1|5', 'Amla Ginger Shot|Health Blends|60|1|3',
                    'Mango Smoothie|Smoothies|120|1|5', 'Banana Date Smoothie|Smoothies|120|1|5', 'Strawberry Smoothie|Smoothies|130|1|5', 'Papaya Smoothie|Smoothies|110|1|5',
                    'Seasonal Fruit Bowl|Fruit Bowls|120|1|5', 'Fruit Salad with Honey|Fruit Bowls|130|1|5', 'Coconut Water|Specials|60|1|2', 'Tender Coconut Malai|Specials|80|1|3',
                    'Lemon Honey Ginger Cooler|Specials|70|1|3', 'Sprouts Chaat Cup|Specials|80|1|5',
                ],
            ],
            'Tea & Coffee' => [
                'names' => ['Chai Tapri Express', 'Brew and Bean', 'Kulhad Cafe'],
                'items' => [
                    'Masala Chai|Tea|30|1|4', 'Adrak Chai|Tea|30|1|4', 'Elaichi Chai|Tea|35|1|4', 'Kulhad Chai|Tea|40|1|5',
                    'Tulsi Green Tea|Tea|50|1|4', 'Lemon Tea|Tea|40|1|3', 'Iced Tea|Tea|80|1|3', 'Kashmiri Kahwa|Tea|70|1|5',
                    'Espresso|Coffee|70|1|3', 'Americano|Coffee|90|1|3', 'Cappuccino|Coffee|110|1|4', 'Cafe Latte|Coffee|120|1|4',
                    'Filter Coffee|Coffee|50|1|4', 'Hot Chocolate|Coffee|120|1|5', 'Cold Coffee|Cold Brews|110|1|5', 'Cold Brew|Cold Brews|130|1|3',
                    'Vanilla Frappe|Cold Brews|150|1|5', 'Bun Maska|Bites|40|1|3', 'Maska Pav|Bites|45|1|3', 'Rusk (6 pc)|Bites|30|1|2',
                    'Veg Sandwich|Bites|90|1|6', 'Cheese Toast|Bites|80|1|5',
                ],
            ],
        ];
    }

    /** @return string[] */
    public static function firstNames(): array
    {
        return [
            'Aarav', 'Vihaan', 'Rohan', 'Kabir', 'Arjun', 'Ishaan', 'Siddharth', 'Karan', 'Manish', 'Rahul',
            'Priya', 'Anjali', 'Neha', 'Kavita', 'Sneha', 'Pooja', 'Meera', 'Divya', 'Sunita', 'Rekha',
            'Imran', 'Farhan', 'Gurpreet', 'Harpreet', 'Vikram',
        ];
    }

    /** @return string[] */
    public static function lastNames(): array
    {
        return ['Sharma', 'Patil', 'Deshmukh', 'Iyer', 'Reddy', 'Singh', 'Kulkarni', 'Mehta', 'Khan', 'Nair', 'Joshi', 'Gupta', 'Shah', 'Pillai'];
    }

    /** @return string[] */
    public static function locations(): array
    {
        return ['Ground Floor, Block A', 'Ground Floor, Block B', 'First Floor, Block A', 'First Floor, Block B', 'Food Street, Wing C'];
    }

    /** @return string[] "HH:MM-HH:MM" */
    public static function hours(): array
    {
        return ['08:00-20:00', '09:00-21:00', '10:00-22:00', '11:00-23:00', '07:00-15:00', '12:00-24:00'];
    }
}
