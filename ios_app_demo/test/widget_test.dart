import 'package:flutter_test/flutter_test.dart';
import 'package:ios_app_demo/main.dart';

void main() {
  testWidgets('Hybrid App smoke test', (WidgetTester tester) async {
    // Build our app and trigger a frame.
    await tester.pumpWidget(const HybridApp());

    // Verify that the app builds without crashing.
    // We can also check for specific text based on platform, but for now just building is enough.
    expect(find.byType(HybridApp), findsOneWidget);
  });
}
