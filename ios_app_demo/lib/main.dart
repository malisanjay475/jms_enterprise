import 'dart:io' show Platform;
import 'package:flutter/cupertino.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';

void main() {
  runApp(const HybridApp());
}

class HybridApp extends StatelessWidget {
  const HybridApp({super.key});

  @override
  Widget build(BuildContext context) {
    // Determine if we should show iOS style
    // We check for iOS directly, OR if we are on Web (just for demo purposes to default to Material)
    final bool isIOS = !kIsWeb && Platform.isIOS;

    if (isIOS) {
      return const CupertinoApp(
        title: 'Hybrid App',
        theme: CupertinoThemeData(
          primaryColor: CupertinoColors.activeBlue,
          brightness: Brightness.light,
        ),
        home: IOSHomePage(),
      );
    } else {
      return MaterialApp(
        title: 'Hybrid App',
        theme: ThemeData(
          primarySwatch: Colors.blue,
          useMaterial3: true,
        ),
        home: const AndroidHomePage(),
      );
    }
  }
}

// -----------------------------------------------------------------------------
// iOS Implementation (Cupertino)
// -----------------------------------------------------------------------------
class IOSHomePage extends StatelessWidget {
  const IOSHomePage({super.key});

  @override
  Widget build(BuildContext context) {
    return CupertinoPageScaffold(
      navigationBar: const CupertinoNavigationBar(
        middle: Text('iOS View'),
      ),
      child: SafeArea(
        child: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(CupertinoIcons.phone, size: 80, color: CupertinoColors.activeBlue),
              const SizedBox(height: 20),
              const Text(
                'This is Cupertino Style',
                style: TextStyle(fontSize: 20, fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: 10),
              CupertinoButton.filled(
                child: const Text('Show Action Sheet'),
                onPressed: () {
                  showCupertinoModalPopup(
                    context: context,
                    builder: (context) => CupertinoActionSheet(
                      title: const Text('iOS Choices'),
                      actions: [
                        CupertinoActionSheetAction(
                          child: const Text('Option A'),
                          onPressed: () => Navigator.pop(context),
                        ),
                        CupertinoActionSheetAction(
                          child: const Text('Option B'),
                          onPressed: () => Navigator.pop(context),
                        ),
                      ],
                      cancelButton: CupertinoActionSheetAction(
                        isDestructiveAction: true,
                        child: const Text('Cancel'),
                        onPressed: () => Navigator.pop(context),
                      ),
                    ),
                  );
                },
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// -----------------------------------------------------------------------------
// Android Implementation (Material)
// -----------------------------------------------------------------------------
class AndroidHomePage extends StatelessWidget {
  const AndroidHomePage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Android View'),
        backgroundColor: Theme.of(context).colorScheme.inversePrimary,
      ),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.android, size: 80, color: Colors.green),
            const SizedBox(height: 20),
            Text(
              'This is Material Style',
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: 10),
            FilledButton(
              onPressed: () {
                showModalBottomSheet(
                  context: context,
                  builder: (context) => Container(
                    padding: const EdgeInsets.all(20),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Text(
                          'Android Bottom Sheet',
                          style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                        ),
                        ListTile(
                          leading: const Icon(Icons.share),
                          title: const Text('Share'),
                          onTap: () => Navigator.pop(context),
                        ),
                        ListTile(
                          leading: const Icon(Icons.link),
                          title: const Text('Get Link'),
                          onTap: () => Navigator.pop(context),
                        ),
                      ],
                    ),
                  ),
                );
              },
              child: const Text('Show Bottom Sheet'),
            ),
          ],
        ),
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () {},
        child: const Icon(Icons.add),
      ),
    );
  }
}
