<?php

namespace Database\Seeders\Demo\Data;

/**
 * Dish pools for the Indian demo dataset. A line is "Dish name|price INR|V/N/E|prep minutes" and an optional 5th field "S"
 * marks a side, drink or sweet (it goes into the stall's secondary menu category). V = vegetarian, N = non-vegetarian, E = egg.
 * All names and prices are invented demo data; nothing here is a real business's menu.
 */
final class DishPools
{
    /** @return array<string, string[]> */
    public static function all(): array
    {
        return [
            'north' => [
                'Paneer Butter Masala|220|V|15', 'Dal Tadka|160|V|12', 'Dal Makhani|190|V|15', 'Butter Naan|45|V|8|S', 'Garlic Naan|55|V|8|S', 'Tandoori Roti|20|V|6|S',
                'Chole Bhature|120|V|12', 'Rajma Chawal|140|V|12', 'Veg Thali|180|V|12', 'Kadai Paneer|230|V|16', 'Shahi Paneer|240|V|16', 'Palak Paneer|210|V|15',
                'Malai Kofta|230|V|18', 'Aloo Gobi|150|V|12', 'Mix Veg Curry|160|V|12', 'Jeera Rice|110|V|10|S', 'Veg Pulao|150|V|12', 'Butter Chicken|300|N|18',
                'Chicken Curry|270|N|18', 'Kadai Chicken|290|N|18', 'Mutton Rogan Josh|380|N|25', 'Egg Curry|170|E|12', 'Bhindi Masala|150|V|12', 'Baingan Bharta|160|V|15',
                'Lachha Paratha|50|V|8|S', 'Boondi Raita|60|V|3|S', 'Masala Papad|35|V|3|S', 'Gulab Jamun (2 pc)|50|V|3|S', 'Sweet Lassi|70|V|3|S', 'Chaas|35|V|2|S',
                'Paneer Tikka Masala|240|V|16', 'Dal Fry with Rice|150|V|12', 'Kashmiri Dum Aloo|190|V|15', 'Methi Malai Matar|220|V|15', 'Matar Paneer|200|V|15',
            ],
            'south' => [
                'Plain Dosa|70|V|10', 'Masala Dosa|100|V|12', 'Mysore Masala Dosa|130|V|12', 'Rava Dosa|110|V|12', 'Onion Rava Dosa|120|V|12', 'Set Dosa (3 pc)|100|V|10', 'Paper Dosa|110|V|12',
                'Ghee Roast Dosa|120|V|12', 'Cheese Dosa|140|V|12', 'Paneer Dosa|150|V|14', 'Podi Dosa|90|V|10', 'Idli Sambar (2 pc)|60|V|6', 'Idli Sambar (4 pc)|100|V|6', 'Ghee Podi Idli|90|V|8',
                'Medu Vada (2 pc)|50|V|8', 'Sambar Vada|70|V|8', 'Dahi Vada South Style|80|V|5', 'Onion Uttapam|90|V|12', 'Tomato Uttapam|90|V|12', 'Mixed Veg Uttapam|110|V|14',
                'Pongal|80|V|10', 'Upma|60|V|8', 'Rava Kesari|50|V|5|S', 'Lemon Rice|90|V|8', 'Curd Rice|80|V|6', 'Tamarind Rice|90|V|8', 'Bisi Bele Bath|110|V|12',
                'Vermicelli Upma|60|V|8', 'Filter Coffee|40|V|4|S', 'Badam Milk|60|V|4|S', 'Coconut Chutney Combo|30|V|2|S', 'Kerala Parotta (2 pc)|70|V|10', 'Veg Kurma|110|V|12',
                'Appam with Stew|140|V|14', 'Mini Tiffin Combo|150|V|12', 'Banana Bajji (3 pc)|50|V|8|S', 'Payasam|60|V|4|S', 'Ven Pongal Vada Combo|110|V|10', 'Rasam Rice|90|V|8', 'Sambar Rice|90|V|8',
            ],
            'maha' => [
                'Misal Pav|90|V|10', 'Kolhapuri Misal|120|V|12', 'Pune Style Misal|100|V|10', 'Vada Pav|25|V|5', 'Kanda Poha|40|V|8', 'Batata Poha|40|V|8', 'Sabudana Khichdi|70|V|10',
                'Sabudana Vada (2 pc)|60|V|8', 'Pithla Bhakri|130|V|12', 'Thalipeeth with Curd|80|V|12', 'Zunka Bhakar|120|V|12', 'Usal Pav|70|V|8', 'Kothimbir Vadi|70|V|10',
                'Bharli Vangi|140|V|15', 'Varan Bhaat|100|V|10', 'Maharashtrian Thali|190|V|14', 'Matki Usal|90|V|10', 'Alu Vadi|70|V|10', 'Batata Bhaji Pav|70|V|8',
                'Kolhapuri Tambda Rassa|260|N|20', 'Pandhra Rassa|260|N|20', 'Chicken Sukka|250|N|18', 'Mutton Sukka|340|N|25', 'Surmai Fry|320|N|18', 'Bombil Fry|230|N|15',
                'Puran Poli|60|V|6|S', 'Shrikhand|70|V|3|S', 'Modak (2 pc)|60|V|5|S', 'Sol Kadhi|40|V|3|S', 'Taak (Buttermilk)|30|V|2|S', 'Masala Chai|20|V|4|S', 'Amrakhand|80|V|3|S',
                'Jhunka with Roti|110|V|10', 'Sheera|50|V|6|S', 'Mirchi Bhaji (3 pc)|40|V|6', 'Kanda Bhaji|50|V|8', 'Ukdiche Modak|70|V|6|S',
            ],
            'gujarati' => [
                'Khaman Dhokla|60|V|6', 'Khandvi|70|V|6', 'Fafda Jalebi|80|V|6', 'Gujarati Thali|220|V|14', 'Mini Gujarati Thali|160|V|12', 'Undhiyu|180|V|15', 'Sev Tamatar Sabzi|130|V|10',
                'Ringan Bharta|150|V|12', 'Gujarati Dal|110|V|10', 'Gujarati Kadhi|100|V|10', 'Dal Dhokli|140|V|15', 'Bajra Rotla|50|V|8|S', 'Thepla (3 pc)|70|V|8|S', 'Puri (4 pc)|60|V|8|S',
                'Handvo|80|V|10', 'Locho|70|V|6', 'Muthiya|70|V|10', 'Patra|70|V|8', 'Dhokla Sandwich|70|V|6', 'Khichdi Kadhi|140|V|12', 'Bhakhri Shaak|120|V|10',
                'Masala Chaas|35|V|2|S', 'Shrikhand|80|V|3|S', 'Basundi|80|V|3|S', 'Mohanthal|60|V|2|S', 'Jalebi (100g)|50|V|4|S', 'Gathiya (100g)|40|V|2|S', 'Khakhra with Chutney|50|V|2|S',
            ],
            'punjabi' => [
                'Amritsari Kulcha|90|V|10', 'Pindi Chole|150|V|12', 'Chole Kulcha|140|V|12', 'Sarson Da Saag|180|V|15', 'Makki Di Roti|60|V|8|S', 'Dal Makhani|200|V|15', 'Rajma Masala|150|V|12',
                'Paneer Lababdar|250|V|16', 'Shahi Paneer|250|V|16', 'Butter Chicken|310|N|18', 'Chicken Tikka Masala|300|N|18', 'Mutton Handi|390|N|28', 'Amritsari Fish Fry|290|N|18',
                'Aloo Paratha with Butter|90|V|10', 'Gobi Paratha|100|V|10', 'Paneer Paratha|120|V|10', 'Pyaaz Kulcha|85|V|10', 'Stuffed Naan|80|V|10|S', 'Lassi (Large)|90|V|3|S',
                'Meethi Lassi|80|V|3|S', 'Chaas|35|V|2|S', 'Firni|70|V|3|S', 'Kadhi Pakora|130|V|12', 'Dal Tadka|150|V|12', 'Jeera Aloo|130|V|10', 'Veg Biryani Punjabi Style|170|V|15',
                'Tandoori Aloo|150|V|12', 'Paneer Tikka|240|V|15', 'Chicken Tikka|280|N|18', 'Tandoori Chicken (Half)|290|N|25',
            ],
            'rajasthani' => [
                'Dal Baati Churma|220|V|18', 'Gatte ki Sabzi|150|V|12', 'Ker Sangri|190|V|15', 'Laal Maas|380|N|28', 'Pyaaz Kachori|40|V|8', 'Mirchi Vada|40|V|8', 'Mawa Kachori|70|V|6|S',
                'Bajre ki Roti|45|V|8|S', 'Missi Roti|40|V|8|S', 'Rajasthani Thali|240|V|15', 'Bikaneri Bhujia Sev|60|V|3|S', 'Ghevar|90|V|4|S', 'Churma Ladoo|60|V|3|S', 'Moong Dal Halwa|90|V|5|S',
                'Papad ki Sabzi|130|V|10', 'Pyaz ki Sabzi|120|V|10', 'Rajasthani Kadhi|120|V|10', 'Khichdi Rajasthani|130|V|12', 'Bati (3 pc) with Dal|140|V|15', 'Aloo Pyaz Sabzi|110|V|10',
                'Mangodi Sabzi|140|V|12', 'Chaas Masala|35|V|2|S', 'Thandai|70|V|4|S', 'Kesar Doodh|70|V|4|S', 'Jodhpuri Mirchi Bada|45|V|8', 'Dahi Kachori|60|V|6',
            ],
            'chinese' => [
                'Veg Hakka Noodles|130|V|10', 'Chicken Hakka Noodles|170|N|12', 'Egg Hakka Noodles|150|E|10', 'Schezwan Noodles|150|V|10', 'Singapore Noodles|160|V|12', 'Veg Fried Rice|130|V|10',
                'Schezwan Fried Rice|150|V|10', 'Chicken Fried Rice|170|N|12', 'Egg Fried Rice|150|E|10', 'Triple Schezwan Rice|220|N|14', 'Veg Manchurian|160|V|12', 'Chicken Manchurian|200|N|14',
                'Paneer Chilli|190|V|12', 'Chilli Chicken|230|N|15', 'Gobi Manchurian|150|V|12', 'Crispy Corn|150|V|10', 'Honey Chilli Potato|140|V|10', 'Spring Roll (2 pc)|100|V|10',
                'Veg Manchow Soup|90|V|8', 'Hot and Sour Soup|90|V|8', 'Sweet Corn Soup|90|V|8', 'Chicken Sweet Corn Soup|120|N|8', 'Veg Momos (6 pc)|100|V|10', 'Chicken Momos (6 pc)|130|N|10',
                'Dragon Paneer|210|V|14', 'Kung Pao Chicken|250|N|15', 'Chilli Garlic Noodles|140|V|10', 'American Chopsuey|180|V|12', 'Veg Schezwan Gravy|170|V|12', 'Manchurian Gravy Combo|190|V|14',
                'Lemon Coriander Soup|90|V|8', 'Paneer Fried Rice|170|V|12', 'Burnt Garlic Rice|150|V|10', 'Chilli Paneer Gravy|200|V|14', 'Veg Lollipop|140|V|12', 'Drums of Heaven|180|V|12',
            ],
            'street' => [
                'Pani Puri (6 pc)|40|V|5', 'Sev Puri|50|V|5', 'Bhel Puri|50|V|5', 'Dahi Puri|70|V|5', 'Ragda Pattice|70|V|8', 'Pav Bhaji|120|V|10', 'Cheese Pav Bhaji|150|V|12', 'Masala Pav|80|V|8',
                'Samosa|20|V|6', 'Samosa Chaat|60|V|6', 'Kachori with Aloo Sabzi|50|V|8', 'Dahi Vada|70|V|5', 'Papdi Chaat|70|V|5', 'Aloo Tikki Chaat|80|V|8', 'Raj Kachori|80|V|6', 'Dabeli|40|V|5',
                'Vada Pav|25|V|5', 'Cheese Vada Pav|45|V|6', 'Schezwan Vada Pav|40|V|6', 'Jumbo Vada Pav|45|V|6', 'Batata Vada (2 pc)|50|V|6', 'Misal Pav|90|V|10', 'Chole Kulche|90|V|8', 'Aloo Chaat|60|V|6',
                'Corn Chaat|70|V|5', 'Sprouts Bhel|60|V|5', 'Tawa Pulao|120|V|10', 'Pav Bhaji Fondue|170|V|12', 'Khada Pav Bhaji|130|V|10', 'Butter Pav (2 pc)|30|V|3|S',
                'Masala Soda|40|V|3|S', 'Kala Khatta Gola|40|V|3|S', 'Sugarcane Juice|40|V|3|S', 'Jaljeera|30|V|3|S', 'Bun Maska|40|V|3|S', 'Tikki Burger|60|V|6', 'Bread Pakoda|40|V|6',
                'Mirchi Bhajji (3 pc)|50|V|6', 'Palak Chaat|80|V|6', 'Basket Chaat|90|V|8', 'Dahi Papdi Chaat|80|V|5', 'Sev Batata Puri|60|V|5', 'Ragda Patties Plate|80|V|8', 'Tawa Sandwich|70|V|6',
            ],
            'biryani' => [
                'Veg Biryani|160|V|20', 'Paneer Biryani|190|V|20', 'Chicken Biryani|220|N|25', 'Hyderabadi Dum Biryani|250|N|28', 'Mutton Biryani|340|N|30', 'Egg Biryani|180|E|18', 'Chicken 65 Biryani|250|N|25',
                'Lucknowi Chicken Biryani|240|N|25', 'Chicken Tikka Biryani|260|N|25', 'Prawn Biryani|330|N|25', 'Fish Biryani|300|N|25', 'Mushroom Biryani|190|V|20', 'Biryani Family Pack (Chicken)|780|N|30',
                'Biryani Family Pack (Veg)|560|V|30', 'Chicken 65|230|N|15', 'Paneer 65|200|V|15', 'Mirchi ka Salan|70|V|5|S', 'Boiled Egg Raita|60|E|3|S', 'Onion Raita|50|V|3|S', 'Double ka Meetha|80|V|5|S',
                'Qubani ka Meetha|90|V|5|S', 'Shahi Tukda|90|V|5|S', 'Mutton Keema Pav|220|N|15', 'Chicken Haleem|240|N|20', 'Mutton Nihari|360|N|28', 'Chicken Korma|280|N|18', 'Mutton Seekh Kebab|320|N|20',
                'Chicken Reshmi Kebab|290|N|20', 'Galouti Kebab|330|N|20', 'Veg Seekh Kebab|180|V|15', 'Sheermal (2 pc)|70|V|8|S', 'Rumali Roti|25|V|5|S', 'Phirni|70|V|3|S', 'Sulaimani Chai|40|V|4|S',
                'Soft Drink (300ml)|40|V|1|S',
            ],
            'tandoor' => [
                'Paneer Tikka|240|V|15', 'Malai Paneer Tikka|260|V|16', 'Achari Paneer Tikka|250|V|16', 'Hara Bhara Kebab|190|V|14', 'Tandoori Soya Chaap|190|V|15', 'Malai Soya Chaap|200|V|15', 'Tandoori Aloo|150|V|12',
                'Tandoori Mushroom|210|V|15', 'Tandoori Chicken (Half)|290|N|25', 'Tandoori Chicken (Full)|520|N|30', 'Chicken Tikka|280|N|18', 'Chicken Malai Tikka|300|N|18', 'Chicken Reshmi Kebab|290|N|20',
                'Afghani Chicken|310|N|22', 'Seekh Kebab|300|N|20', 'Fish Tikka|340|N|18', 'Tandoori Prawns|420|N|18', 'Mutton Seekh|340|N|22', 'Tandoori Platter Veg|420|V|25', 'Tandoori Platter Non-Veg|620|N|30',
                'Butter Naan|45|V|8|S', 'Garlic Naan|55|V|8|S', 'Tandoori Roti|20|V|6|S', 'Missi Roti|35|V|6|S', 'Rumali Roti|25|V|5|S', 'Mint Chutney Dip|20|V|1|S', 'Onion Laccha Salad|40|V|2|S', 'Masala Lemon Soda|40|V|3|S',
                'Paneer Kathi Roll|130|V|10', 'Chicken Tikka Roll|160|N|10', 'Tandoori Momos (6 pc)|140|V|12', 'Tandoori Chicken Momos|170|N|12', 'Dal Makhani|190|V|15', 'Butter Chicken|300|N|18',
            ],
            'pizza' => [
                'Margherita Pizza|229|V|15', 'Farmhouse Pizza|319|V|18', 'Veggie Supreme Pizza|339|V|18', 'Paneer Tikka Pizza|329|V|18', 'Mushroom Delight Pizza|319|V|18', 'Corn and Cheese Pizza|289|V|15',
                'Pepperoni Pizza|379|N|18', 'BBQ Chicken Pizza|369|N|18', 'Chicken Tikka Pizza|369|N|18', 'Peri Peri Chicken Pizza|379|N|18', 'Four Cheese Pizza|399|V|18', 'Cheese Burst Margherita|349|V|18',
                'Garlic Bread|99|V|8|S', 'Cheesy Garlic Bread|139|V|8|S', 'Stuffed Garlic Bread|159|V|10|S', 'Veg Pasta Alfredo|229|V|12', 'Penne Arrabbiata|219|V|12', 'Chicken White Sauce Pasta|259|N|14',
                'Pasta Pink Sauce Veg|239|V|12', 'Baked Mac and Cheese|229|V|14', 'Choco Lava Cake|109|V|6|S', 'Tiramisu Cup|149|V|3|S', 'Iced Lemon Tea|90|V|3|S', 'Spaghetti Aglio e Olio|229|V|12',
                'Spaghetti Bolognese|279|N|15', 'Chicken Alfredo Pasta|289|N|15', 'Pesto Penne|249|V|12', 'Lasagna Veg|289|V|20', 'Lasagna Chicken|329|N|20', 'Mini Pizza Combo|199|V|12',
                'Pizza Calzone Veg|259|V|15', 'Garden Fresh Pizza|299|V|16', 'Tandoori Paneer Pizza|339|V|18', 'Chicken Sausage Pizza|359|N|18', 'Pizza Pocket|120|V|8', 'Mocktail Virgin Mojito|110|V|4|S',
            ],
            'burger' => [
                'Aloo Tikki Burger|79|V|6', 'Veg Cheese Burger|109|V|7', 'Paneer Crunch Burger|139|V|8', 'Mexican Bean Burger|129|V|8', 'Double Veg Burger|159|V|9', 'Mushroom Swiss Burger|169|V|9',
                'Classic Chicken Burger|149|N|8', 'Zinger Chicken Burger|179|N|9', 'BBQ Chicken Burger|189|N|9', 'Double Chicken Burger|229|N|10', 'Peri Peri Chicken Burger|179|N|9', 'Egg and Cheese Burger|139|E|8',
                'Classic Fries|89|V|5|S', 'Cheese Loaded Fries|139|V|7|S', 'Peri Peri Fries|109|V|6|S', 'Chicken Wings (6 pc)|219|N|12', 'Onion Rings|99|V|6|S', 'Coleslaw Cup|59|V|2|S',
                'Burger Meal Combo|229|V|10', 'Chicken Burger Meal Combo|279|N|12', 'Chocolate Shake|129|V|4|S', 'Fresh Lime Soda|60|V|3|S', 'Apple Pie|89|V|4|S', 'Veg Club Sandwich|130|V|8',
                'Grilled Cheese Sandwich|120|V|8', 'Chicken Club Sandwich|170|N|10', 'Veg Wrap|120|V|8', 'Paneer Kathi Roll|140|V|8', 'Chicken Kathi Roll|170|N|10', 'Egg Roll|110|E|8',
                'Hot Dog|120|N|8', 'Cheese Maggi|90|V|6', 'Chicken Nuggets (6 pc)|150|N|8', 'Chicken Popcorn|160|N|8', 'Veg Nuggets (6 pc)|120|V|8', 'Masala Fries|99|V|6|S',
                'Cold Coffee|110|V|4|S', 'Choco Brownie|100|V|3|S', 'Veg Pasta Cup|140|V|8', 'Corn Cup|80|V|5',
            ],
            'rolls' => [
                'Veg Kathi Roll|100|V|8', 'Paneer Kathi Roll|130|V|8', 'Chicken Kathi Roll|160|N|10', 'Egg Roll|110|E|8', 'Egg Chicken Roll|150|N|10', 'Mutton Seekh Roll|190|N|12', 'Double Egg Roll|130|E|8',
                'Schezwan Veg Roll|120|V|8', 'Frankie Roll|90|V|6', 'Chicken Frankie|120|N|8', 'Paneer Tikka Wrap|150|V|10', 'Chicken Tikka Wrap|170|N|10', 'Falafel Wrap|140|V|10', 'Mexican Veg Wrap|130|V|8',
                'Veg Momos (6 pc)|100|V|10', 'Chicken Momos (6 pc)|130|N|10', 'Paneer Momos (6 pc)|120|V|10', 'Fried Momos (6 pc)|120|V|10', 'Schezwan Momos (6 pc)|130|V|12', 'Tandoori Momos (6 pc)|140|V|12',
                'Cheese Corn Momos (6 pc)|130|V|10', 'Kurkure Momos (6 pc)|140|V|12', 'Momos Platter (12 pc)|220|V|14', 'Darjeeling Thukpa|140|V|10', 'Chicken Thukpa|170|N|12', 'Momo Chutney Dip|20|V|1|S',
                'Veg Spring Roll (2 pc)|100|V|10', 'Chicken Spring Roll (2 pc)|130|N|10', 'Hot Garlic Sauce Combo|40|V|1|S', 'Cold Coffee|100|V|4|S', 'Masala Lemon Soda|40|V|3|S', 'Peri Peri Fries|110|V|6|S',
                'Roll Combo (Veg)|160|V|10', 'Roll Combo (Chicken)|210|N|12', 'Chicken Lollipop (4 pc)|180|N|12', 'Veg Chowmein|100|V|8',
            ],
            'thali' => [
                'Veg Thali|180|V|12', 'Special Veg Thali|250|V|14', 'Mini Thali|140|V|10', 'Jain Thali|200|V|12', 'Maharashtrian Thali|190|V|14', 'Punjabi Thali|220|V|14', 'South Indian Meals|160|V|12',
                'Gujarati Thali|210|V|14', 'Rajasthani Thali|240|V|15', 'Bengali Veg Thali|230|V|15', 'Non-Veg Thali (Chicken)|280|N|18', 'Non-Veg Thali (Mutton)|380|N|22', 'Fish Thali|320|N|18',
                'Executive Lunch Box|170|V|10', 'Dal Rice Combo|120|V|10', 'Rajma Rice Combo|130|V|10', 'Chole Rice Combo|130|V|10', 'Kadhi Khichdi Combo|140|V|12', 'Paneer Meal Combo|210|V|14',
                'Chicken Curry Meal|240|N|16', 'Egg Curry Meal|180|E|12', 'Family Meal Veg (4 pax)|720|V|25', 'Family Meal Non-Veg (4 pax)|950|N|30', 'Family Feast Platter (6 pax)|1090|V|30',
                'Combo Meal 1 (Burger+Fries+Drink)|199|V|10', 'Combo Meal 2 (Pizza+Garlic Bread+Drink)|299|V|18', 'Combo Meal 3 (Noodles+Manchurian)|229|V|14', 'Student Combo (Roll+Chai)|99|V|8',
                'Steamed Rice|60|V|6|S', 'Roti (2 pc)|30|V|5|S', 'Papad|20|V|2|S', 'Sweet Dish of the Day|50|V|2|S', 'Chaas Glass|30|V|2|S', 'Mixed Pickle|15|V|1|S', 'Green Salad|40|V|3|S', 'Extra Dal Bowl|50|V|3|S',
            ],
            'snacks' => [
                'Medu Vada (2 pc)|50|V|8', 'Masala Vada|40|V|8', 'Mysore Bonda|50|V|8', 'Murukku (100g)|50|V|2', 'Banana Chips (100g)|60|V|2', 'Mixture (100g)|50|V|2', 'Chakli (100g)|50|V|2|S',
                'Chivda (100g)|45|V|2', 'Bhakarwadi (100g)|60|V|2', 'Shankarpali (100g)|50|V|2', 'Kothimbir Vadi|70|V|10', 'Alu Vadi|70|V|10', 'Sabudana Vada (2 pc)|60|V|8', 'Batata Vada (2 pc)|50|V|6',
                'Samosa|20|V|6', 'Mini Samosa (6 pc)|50|V|6', 'Kachori|25|V|8', 'Dhokla Plate|60|V|6', 'Khandvi Plate|70|V|6', 'Patra Plate|70|V|8', 'Fafda (100g)|50|V|2', 'Gathiya (100g)|40|V|2',
                'Sev Mamra|40|V|3', 'Bhel Mix|50|V|4', 'Roasted Makhana|90|V|2', 'Peanut Chikki|30|V|2|S', 'Masala Peanuts|40|V|2', 'Dal Moth (100g)|40|V|2', 'Onion Pakoda|60|V|8', 'Paneer Pakoda|90|V|8',
                'Bread Pakoda|40|V|6', 'Aloo Bonda|35|V|6', 'Cutlet (2 pc)|60|V|8', 'Corn Bhajiya|60|V|8', 'Masala Chai|25|V|4|S', 'Cutting Chai|15|V|3|S', 'Filter Coffee|40|V|4|S', 'Buttermilk|30|V|2|S',
            ],
            'beverages' => [
                'Orange Juice|80|V|4', 'Mosambi Juice|70|V|4', 'Pineapple Juice|80|V|4', 'Watermelon Juice|70|V|4', 'Pomegranate Juice|110|V|5', 'Apple Juice|100|V|4', 'Sugarcane Juice|40|V|3', 'Carrot Juice|70|V|4',
                'Beetroot Carrot Juice|90|V|4', 'ABC Juice|100|V|5', 'Green Detox Juice|110|V|5', 'Amla Ginger Shot|60|V|3', 'Mango Shake|100|V|5', 'Chocolate Shake|120|V|5', 'Strawberry Shake|120|V|5',
                'Banana Shake|90|V|5', 'Oreo Shake|140|V|5', 'Cold Coffee|90|V|5', 'Fresh Lime Soda|40|V|3', 'Masala Soda|40|V|3', 'Blue Lagoon|110|V|4', 'Virgin Mojito|110|V|4', 'Watermelon Cooler|90|V|4',
                'Jaljeera|30|V|3', 'Aam Panna|60|V|4', 'Buttermilk|30|V|2', 'Sweet Lassi|70|V|3', 'Mango Lassi|90|V|3', 'Rose Milk|60|V|3', 'Badam Milk|80|V|5', 'Coconut Water|60|V|2', 'Tender Coconut Malai|80|V|3',
                'Mint Lemonade|60|V|3', 'Iced Peach Tea|100|V|3', 'Iced Lemon Tea|90|V|3', 'Packaged Water 1L|20|V|1', 'Seasonal Fruit Bowl|120|V|5', 'Fruit Salad with Honey|130|V|5', 'Papaya Bowl|80|V|4', 'Sprouts Cup|70|V|4',
                'Thandai|70|V|4', 'Kokum Sharbat|50|V|3', 'Chikoo Shake|100|V|5', 'Dry Fruit Shake|150|V|6', 'Banana Date Smoothie|120|V|5', 'Mango Smoothie|120|V|5',
            ],
            'tea' => [
                'Cutting Chai|15|V|3', 'Masala Tea|25|V|4', 'Adrak Chai|25|V|4', 'Elaichi Chai|30|V|4', 'Kulhad Chai|40|V|5', 'Tulsi Green Tea|50|V|4', 'Lemon Tea|40|V|3', 'Iced Tea|80|V|3',
                'Kashmiri Kahwa|70|V|5', 'Espresso|70|V|3', 'Americano|90|V|3', 'Cappuccino|110|V|4', 'Cafe Latte|120|V|4', 'Filter Coffee|50|V|4', 'Hot Chocolate|120|V|5', 'Cold Coffee|90|V|5',
                'Cold Brew|130|V|3', 'Bun Maska|40|V|3', 'Maska Pav|45|V|3', 'Rusk (6 pc)|30|V|2', 'Veg Sandwich|90|V|6', 'Cheese Toast|80|V|5', 'Khari Biscuit (100g)|30|V|2', 'Butter Croissant|70|V|3',
                'Chocolate Croissant|90|V|3', 'Vanilla Cupcake|60|V|2', 'Chocolate Cupcake|65|V|2', 'Black Forest Pastry|90|V|2', 'Pineapple Pastry|80|V|2', 'Plum Cake Slice|70|V|2', 'Veg Puff|30|V|4', 'Paneer Puff|40|V|4',
                'Chicken Puff|45|N|4', 'Egg Puff|40|E|4', 'Veg Patties|40|V|4', 'Choco Chip Cookies (6 pc)|120|V|1', 'Jeera Biscuits (200g)|70|V|1', 'Brown Bread Loaf|55|V|2', 'Pav (6 pc)|35|V|2', 'Cheese Bun|45|V|3',
                'Garlic Bread Loaf|110|V|6', 'Fruit Tart|95|V|2', 'Red Velvet Pastry|110|V|2', 'Dutch Truffle Pastry|100|V|2',
            ],
            'desserts' => [
                'Gulab Jamun (2 pc)|50|V|3', 'Rasmalai (2 pc)|110|V|3', 'Jalebi with Rabdi|120|V|6', 'Gajar Halwa|110|V|5', 'Moong Dal Halwa|130|V|5', 'Kaju Katli (4 pc)|140|V|2', 'Rasgulla (2 pc)|60|V|3',
                'Kulfi|40|V|2', 'Malai Kulfi|60|V|2', 'Pista Kulfi|70|V|2', 'Mango Kulfi|70|V|2', 'Kesar Badam Kulfi|80|V|2', 'Matka Kulfi|90|V|2', 'Kulfi Falooda|130|V|4', 'Vanilla Ice Cream|60|V|2',
                'Chocolate Ice Cream|70|V|2', 'Butterscotch Ice Cream|70|V|2', 'Strawberry Ice Cream|70|V|2', 'Mango Ice Cream|75|V|2', 'Black Currant Ice Cream|75|V|2', 'Belgian Chocolate Scoop|90|V|2', 'Choco Chip Cone|80|V|2',
                'Hot Fudge Sundae|160|V|5', 'Brownie Sundae|180|V|6', 'Banana Split|190|V|6', 'Fruit Salad with Ice Cream|150|V|5', 'Ice Cream Sandwich|110|V|3', 'Rolled Ice Cream|170|V|8', 'Falooda|130|V|5',
                'Chocolate Brownie|100|V|3', 'Brownie with Ice Cream|150|V|5', 'Choco Lava Cake|120|V|6', 'New York Cheesecake Slice|170|V|3', 'Tiramisu Cup|160|V|3', 'Fruit Custard|90|V|3', 'Phirni|70|V|3',
                'Chocolate Mousse|110|V|3', 'Mango Pudding|100|V|3', 'Waffle with Chocolate|140|V|8', 'Nutella Waffle|170|V|8', 'Pancake Stack|150|V|8', 'Sizzling Brownie|190|V|8', 'Motichoor Ladoo (2 pc)|50|V|2',
                'Besan Ladoo (2 pc)|50|V|2', 'Kaju Barfi (4 pc)|130|V|2', 'Peda (4 pc)|80|V|2', 'Mysore Pak (4 pc)|90|V|2', 'Soan Papdi (100g)|60|V|2', 'Rabdi|90|V|3', 'Basundi|80|V|3', 'Shrikhand|70|V|3',
                'Puran Poli|60|V|6', 'Modak (2 pc)|60|V|5', 'Imarti|70|V|5', 'Kalakand|90|V|2',
            ],
            'paratha' => [
                'Aloo Paratha|70|V|10', 'Gobi Paratha|80|V|10', 'Paneer Paratha|100|V|10', 'Mooli Paratha|70|V|10', 'Methi Paratha|70|V|10', 'Mix Veg Paratha|90|V|10', 'Onion Paratha|70|V|10',
                'Cheese Paratha|100|V|10', 'Lachha Paratha|45|V|8', 'Pudina Paratha|60|V|8', 'Egg Paratha|90|E|10', 'Chicken Keema Paratha|140|N|12', 'Aloo Paratha with Butter|90|V|10', 'Paratha Combo (2 pc + Curd)|110|V|10',
                'Dahi Bhalla|70|V|4', 'Pickle Curd Bowl|40|V|2|S', 'Chole Bhature|120|V|12', 'Bhatura (2 pc)|60|V|8', 'Rajma Chawal|140|V|12', 'Chole Chawal|130|V|12', 'Kadhi Chawal|120|V|12',
                'Egg Bhurji with Pav|100|E|8', 'Masala Omelette|70|E|6', 'Boiled Egg (2 pc)|30|E|5', 'Egg Curry|170|E|12', 'Egg Biryani|180|E|18', 'Anda Ghotala|110|E|10', 'Egg Roll|110|E|8', 'Egg Fried Rice|150|E|10',
                'Cheese Omelette|90|E|6', 'Half Fry (2 pc)|60|E|5', 'Anda Pav|60|E|6', 'Egg Sandwich|80|E|6', 'Egg Maggi|90|E|7', 'Masala Egg Bhurji|100|E|8', 'Sweet Lassi|70|V|3|S', 'Masala Chai|25|V|4|S', 'Chaas|35|V|2|S',
            ],
            'seafood' => [
                'Surmai Fry|320|N|18', 'Pomfret Fry|380|N|18', 'Bombil Fry|230|N|15', 'Bangda Fry|180|N|15', 'Fish Curry Rice|240|N|15', 'Prawns Masala|340|N|18', 'Prawns Koliwada|320|N|15', 'Tandoori Fish Tikka|340|N|18',
                'Fish Thali|320|N|18', 'Crab Masala|420|N|25', 'Squid Rings|290|N|14', 'Malvani Fish Curry|280|N|18', 'Goan Prawn Curry|330|N|18', 'Fish and Chips|260|N|14', 'Fish Biryani|300|N|25', 'Prawn Biryani|330|N|25',
                'Fish Finger (6 pc)|250|N|12', 'Chilli Fish|280|N|14', 'Fish Amritsari|290|N|15', 'Prawn Fried Rice|290|N|14', 'Solkadhi|40|V|3|S', 'Bhakri (2 pc)|40|V|8|S', 'Steamed Rice|60|V|6|S', 'Lemon Soda|40|V|3|S',
                'Veg Thali (Konkan)|190|V|14', 'Kombdi Vade|290|N|20', 'Kolambi Bhaat|310|N|20', 'Tisrya Masala|300|N|18',
            ],
            'healthy' => [
                'Sprouts Salad|80|V|5', 'Greek Salad|160|V|5', 'Caesar Salad|170|V|5', 'Chicken Caesar Salad|220|N|6', 'Quinoa Veg Bowl|220|V|10', 'Brown Rice Veg Bowl|190|V|10', 'Paneer Tikka Salad Bowl|230|V|8',
                'Chana Chaat Salad|90|V|5', 'Corn Kachumber|80|V|4', 'Cucumber Raita Bowl|50|V|3', 'Fruit Salad Bowl|110|V|5', 'Oats Porridge|90|V|6', 'Moong Dal Cheela (2 pc)|90|V|8', 'Ragi Dosa|110|V|10',
                'Multigrain Sandwich|110|V|6', 'Grilled Chicken Salad|240|N|10', 'Egg White Omelette|90|E|6', 'Boiled Egg Salad|110|E|5', 'Millet Khichdi|130|V|12', 'Jowar Roti Thali|170|V|12', 'Tofu Stir Fry Bowl|210|V|10',
                'Steamed Veg Momos (6 pc)|100|V|10', 'Lemon Honey Ginger Cooler|70|V|3|S', 'Green Detox Juice|110|V|5|S', 'Coconut Water|60|V|2|S', 'Sprouts Chaat Cup|80|V|5', 'Roasted Makhana|90|V|2|S', 'Dry Fruit Mix (50g)|90|V|1|S',
                'Peanut Butter Toast|90|V|4', 'Avocado Toast|190|V|6', 'Hummus with Pita|160|V|6', 'Falafel Bowl|200|V|10', 'Sattu Sharbat|50|V|3|S', 'Beetroot Salad|70|V|4', 'Protein Smoothie|150|V|5|S',
            ],
            'sides' => [
                'Masala Papad|35|V|3|S', 'Mineral Water 500ml|15|V|1|S', 'Soft Drink 300ml|40|V|1|S', 'Fresh Lime Soda|40|V|3|S', 'Masala Chaas|35|V|2|S', 'Sweet Lassi|70|V|3|S', 'Gulab Jamun (2 pc)|50|V|3|S',
                'Ice Cream Cup|40|V|2|S', 'Cutting Chai|15|V|3|S', 'Cold Coffee|90|V|4|S', 'French Fries|90|V|6|S', 'Green Salad|40|V|3|S', 'Onion Salad|25|V|2|S', 'Pickle Portion|15|V|1|S', 'Extra Butter|20|V|1|S',
                'Extra Cheese|30|V|1|S', 'Steamed Rice|60|V|6|S', 'Roti (2 pc)|30|V|5|S', 'Curd Cup|30|V|1|S', 'Boondi Raita|60|V|3|S', 'Jeera Soda|35|V|3|S', 'Shikanji|40|V|3|S', 'Mango Shake|100|V|5|S',
                'Kulfi|40|V|2|S', 'Brownie|80|V|3|S', 'Packaging Charge Box|15|V|1|S', 'Extra Chutney|15|V|1|S', 'Veg Sandwich|90|V|6|S', 'Samosa|20|V|6|S', 'Masala Chai|25|V|4|S',
            ],
        ];
    }
}
