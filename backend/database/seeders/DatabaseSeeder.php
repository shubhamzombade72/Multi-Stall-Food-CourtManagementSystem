<?php

namespace Database\Seeders;

use App\Models\DiningTable;
use App\Models\InventoryItem;
use App\Models\MenuCategory;
use App\Models\MenuItem;
use App\Models\Stall;
use App\Models\Supplier;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        // Demo staff accounts share a known password: development, testing and staging only
        if (app()->environment('production')) {
            throw new \RuntimeException('DatabaseSeeder creates demo accounts with a shared password and must not run in production.');
        }

        $defaultPassword = Hash::make('password123');

        // 1. Central Owner / Admin
        $owner = User::create([
            'name' => 'Food Court Owner',
            'email' => 'owner@foodcourt.com',
            'password' => $defaultPassword,
            'role' => 'owner',
            'phone' => '+91 98765 00001',
            'is_active' => true,
        ]);

        // 2. Central Cashier
        $cashier = User::create([
            'name' => 'Central Cashier',
            'email' => 'cashier@foodcourt.com',
            'password' => $defaultPassword,
            'role' => 'cashier',
            'phone' => '+91 98765 00002',
            'is_active' => true,
        ]);

        // 3. Waiters
        $waiter1 = User::create([
            'name' => 'Rahul Waiter',
            'email' => 'waiter1@foodcourt.com',
            'password' => $defaultPassword,
            'role' => 'waiter',
            'phone' => '+91 98765 00003',
            'is_active' => true,
        ]);

        $waiter2 = User::create([
            'name' => 'Sunil Waiter',
            'email' => 'waiter2@foodcourt.com',
            'password' => $defaultPassword,
            'role' => 'waiter',
            'phone' => '+91 98765 00004',
            'is_active' => true,
        ]);

        // 4. Stalls Definition
        $stallsData = [
            [
                'name' => 'Pizza & Pasta Co.',
                'code' => 'STALL-PIZZA',
                'description' => 'Authentic wood-fired Italian pizzas and creamy pastas',
                'contact_phone' => '+91 98765 11001',
                'manager' => ['name' => 'Marco Pizza Manager', 'email' => 'manager.pizza@foodcourt.com'],
                'kitchen' => ['name' => 'Luigi Pizza Chef', 'email' => 'kitchen.pizza@foodcourt.com'],
                'supplier' => ['name' => 'Italia Dairy & Imports', 'phone' => '+91 91234 56789'],
                'categories' => [
                    [
                        'name' => 'Wood-Fired Pizzas',
                        'items' => [
                            ['name' => 'Margherita Classic Pizza', 'price' => 249.00, 'is_veg' => true, 'desc' => 'San Marzano tomato sauce, fresh mozzarella, and fragrant basil'],
                            ['name' => 'Farmhouse Veggie Overload', 'price' => 319.00, 'is_veg' => true, 'desc' => 'Bell peppers, onions, black olives, sweet corn, and mushrooms'],
                            ['name' => 'Fiery Peri-Peri Chicken Pizza', 'price' => 379.00, 'is_veg' => false, 'desc' => 'Grilled chicken chunks, spicy peri-peri drizzle, and red paprika'],
                        ]
                    ],
                    [
                        'name' => 'Creamy Pastas & Sides',
                        'items' => [
                            ['name' => 'Creamy Alfredo Penne', 'price' => 229.00, 'is_veg' => true, 'desc' => 'Rich parmesan and garlic cream sauce with butter-sautéed herbs'],
                            ['name' => 'Cheesy Garlic Breadsticks', 'price' => 149.00, 'is_veg' => true, 'desc' => 'Warm toasted baguette with garlic herb butter and melted mozzarella'],
                        ]
                    ]
                ],
                'inventory' => [
                    ['name' => 'Pizza Flour 00', 'unit' => 'kg', 'stock' => 50.0, 'cost' => 65.0],
                    ['name' => 'Mozzarella Cheese Block', 'unit' => 'kg', 'stock' => 20.0, 'cost' => 380.0],
                    ['name' => 'San Marzano Tomato Sauce', 'unit' => 'kg', 'stock' => 30.0, 'cost' => 120.0],
                ]
            ],
            [
                'name' => 'Burger & Grill Express',
                'code' => 'STALL-BURGER',
                'description' => 'Smashed gourmet burgers, crispy loaded fries, and wings',
                'contact_phone' => '+91 98765 11002',
                'manager' => ['name' => 'Vikram Burger Manager', 'email' => 'manager.burger@foodcourt.com'],
                'kitchen' => ['name' => 'Amit Grill Master', 'email' => 'kitchen.burger@foodcourt.com'],
                'supplier' => ['name' => 'Metro Bakers & Meat Wholesale', 'phone' => '+91 91234 56790'],
                'categories' => [
                    [
                        'name' => 'Gourmet Smashed Burgers',
                        'items' => [
                            ['name' => 'Crispy Paneer Supreme Burger', 'price' => 179.00, 'is_veg' => true, 'desc' => 'Herb-crusted cottage cheese patty with thousand-island slaw'],
                            ['name' => 'Smoky BBQ Bacon & Chicken Burger', 'price' => 249.00, 'is_veg' => false, 'desc' => 'Double chicken patty with smoked barbecue glaze and cheese slice'],
                            ['name' => 'Classic Double Smash Cheeseburger', 'price' => 289.00, 'is_veg' => false, 'desc' => 'Caramelized onions, dual melted cheddar, and secret house relish'],
                        ]
                    ],
                    [
                        'name' => 'Loaded Fries & Sides',
                        'items' => [
                            ['name' => 'Cajun Seasoned Crispy Fries', 'price' => 99.00, 'is_veg' => true, 'desc' => 'Golden salted fries tossed in hot Cajun herb dust'],
                            ['name' => 'Cheese Lava Loaded Fries', 'price' => 169.00, 'is_veg' => true, 'desc' => 'Smothered in warm melted cheddar sauce and jalapeno bits'],
                        ]
                    ]
                ],
                'inventory' => [
                    ['name' => 'Brioche Burger Buns', 'unit' => 'pcs', 'stock' => 150.0, 'cost' => 18.0],
                    ['name' => 'Potato Fries (Frozen)', 'unit' => 'kg', 'stock' => 40.0, 'cost' => 95.0],
                    ['name' => 'Cheddar Cheese Slices', 'unit' => 'packet', 'stock' => 25.0, 'cost' => 140.0],
                ]
            ],
            [
                'name' => 'Chai, Cafe & Shakes',
                'code' => 'STALL-BEV',
                'description' => 'Aromatic street teas, cold brews, and thick artisanal shakes',
                'contact_phone' => '+91 98765 11003',
                'manager' => ['name' => 'Pooja Beverage Manager', 'email' => 'manager.bev@foodcourt.com'],
                'kitchen' => ['name' => 'Karan Barista', 'email' => 'kitchen.bev@foodcourt.com'],
                'supplier' => ['name' => 'Farm Fresh Milk & Estates', 'phone' => '+91 91234 56791'],
                'categories' => [
                    [
                        'name' => 'Signature Teas & Coffees',
                        'items' => [
                            ['name' => 'Kadak Adrak-Elaichi Chai (Kullad)', 'price' => 49.00, 'is_veg' => true, 'desc' => 'Slow-brewed ginger and cardamom tea served in traditional clay pot'],
                            ['name' => 'South Indian Filter Coffee', 'price' => 69.00, 'is_veg' => true, 'desc' => 'Freshly brewed chicory-infused decoction with frothy hot milk'],
                            ['name' => 'Hazelnut Iced Cold Coffee', 'price' => 139.00, 'is_veg' => true, 'desc' => 'Double espresso blended with chilled milk and hazelnut syrup'],
                        ]
                    ],
                    [
                        'name' => 'Thick Shakes & Coolers',
                        'items' => [
                            ['name' => 'Belgian Chocolate Overload Shake', 'price' => 179.00, 'is_veg' => true, 'desc' => 'Creamy rich chocolate shake crowned with brownie crumbs'],
                            ['name' => 'Fresh Mint Mojito Spritzer', 'price' => 119.00, 'is_veg' => true, 'desc' => 'Crushed fresh mint, lime chunks, simple syrup, and sparkling soda'],
                        ]
                    ]
                ],
                'inventory' => [
                    ['name' => 'Full Cream Dairy Milk', 'unit' => 'liter', 'stock' => 60.0, 'cost' => 58.0],
                    ['name' => 'Assam CTC Tea Leaves', 'unit' => 'kg', 'stock' => 15.0, 'cost' => 320.0],
                    ['name' => 'Arabica Coffee Beans', 'unit' => 'kg', 'stock' => 10.0, 'cost' => 650.0],
                ]
            ]
        ];

        foreach ($stallsData as $sData) {
            $stall = Stall::create([
                'name' => $sData['name'],
                'code' => $sData['code'],
                'description' => $sData['description'],
                'contact_phone' => $sData['contact_phone'],
                'is_active' => true,
            ]);

            // Create Stall Manager
            User::create([
                'name' => $sData['manager']['name'],
                'email' => $sData['manager']['email'],
                'password' => $defaultPassword,
                'role' => 'stall_manager',
                'stall_id' => $stall->id,
                'is_active' => true,
            ]);

            // Create Kitchen Staff
            User::create([
                'name' => $sData['kitchen']['name'],
                'email' => $sData['kitchen']['email'],
                'password' => $defaultPassword,
                'role' => 'kitchen_staff',
                'stall_id' => $stall->id,
                'is_active' => true,
            ]);

            // Create Supplier
            Supplier::create([
                'stall_id' => $stall->id,
                'name' => $sData['supplier']['name'],
                'phone' => $sData['supplier']['phone'],
                'is_active' => true,
            ]);

            // Create Categories & Items
            foreach ($sData['categories'] as $cIdx => $catData) {
                $category = MenuCategory::create([
                    'stall_id' => $stall->id,
                    'name' => $catData['name'],
                    'display_order' => $cIdx + 1,
                    'is_active' => true,
                ]);

                foreach ($catData['items'] as $itemData) {
                    MenuItem::create([
                        'stall_id' => $stall->id,
                        'category_id' => $category->id,
                        'name' => $itemData['name'],
                        'description' => $itemData['desc'],
                        'price' => $itemData['price'],
                        'is_veg' => $itemData['is_veg'],
                        'is_available' => true,
                        'preparation_time_minutes' => 10,
                    ]);
                }
            }

            // Create Inventory Items
            foreach ($sData['inventory'] as $invData) {
                InventoryItem::create([
                    'stall_id' => $stall->id,
                    'name' => $invData['name'],
                    'unit' => $invData['unit'],
                    'current_stock' => $invData['stock'],
                    'minimum_alert_stock' => 10.0,
                    'unit_cost' => $invData['cost'],
                ]);
            }
        }

        // 5. Dining Tables
        $tables = [
            ['table_number' => 'T-01', 'capacity' => 2, 'section' => 'Main Hall'],
            ['table_number' => 'T-02', 'capacity' => 4, 'section' => 'Main Hall'],
            ['table_number' => 'T-03', 'capacity' => 4, 'section' => 'Main Hall'],
            ['table_number' => 'T-04', 'capacity' => 6, 'section' => 'Main Hall'],
            ['table_number' => 'T-05', 'capacity' => 4, 'section' => 'Patio & Garden'],
            ['table_number' => 'T-06', 'capacity' => 4, 'section' => 'Patio & Garden'],
            ['table_number' => 'T-07', 'capacity' => 2, 'section' => 'Patio & Garden'],
            ['table_number' => 'T-08', 'capacity' => 8, 'section' => 'Family Lounge'],
            ['table_number' => 'T-09', 'capacity' => 6, 'section' => 'Family Lounge'],
            ['table_number' => 'T-10', 'capacity' => 4, 'section' => 'Quick Bites Counter'],
        ];

        foreach ($tables as $t) {
            DiningTable::create([
                'table_number' => $t['table_number'],
                'capacity' => $t['capacity'],
                'section' => $t['section'],
                'qr_token' => 'QR-' . $t['table_number'] . '-' . strtoupper(Str::random(6)),
                'status' => 'available',
                'is_active' => true,
            ]);
        }
    }
}
