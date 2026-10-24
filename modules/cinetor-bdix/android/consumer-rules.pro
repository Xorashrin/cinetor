# Commons Net discovers bounded LIST parsers by class name.
-keep class org.apache.commons.net.ftp.parser.** { *; }
# The optional download module exposes this native-only exact-URI registry reflectively.
-keep class expo.modules.cinetormedia.TrustedLoopbackSources { public static *; }
